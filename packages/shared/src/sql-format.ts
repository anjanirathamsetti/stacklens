/**
 * Small, dependency-free SQL formatter and tokenizer for displaying captured queries.
 *
 * Layout: each clause on its own line with its contents indented, one item per line in
 * SELECT / GROUP BY / ORDER BY / SET / RETURNING lists, AND / OR on their own lines, and subqueries
 * indented. It only changes whitespace: string literals, quoted identifiers, parameters and comments
 * are passed through untouched.
 */

export type SqlTokenType = 'ws' | 'comment' | 'string' | 'ident' | 'number' | 'param' | 'keyword' | 'word' | 'op' | 'punct';
export interface SqlToken {
  type: SqlTokenType;
  text: string;
}

const KEYWORDS = new Set(
  `ADD ALL ALTER AND ANY AS ASC BEGIN BETWEEN BY CASCADE CASE CAST CHECK COALESCE COLLATE COLUMN COMMIT CONFLICT CONSTRAINT
  COUNT CREATE CROSS CURRENT_DATE CURRENT_TIMESTAMP DEFAULT DELETE DESC DISTINCT DO DROP ELSE END EXCEPT EXISTS EXPLAIN
  FALSE FETCH FILTER FIRST FOR FOREIGN FROM FULL GROUP HAVING ILIKE IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY LAST
  LATERAL LEFT LIKE LIMIT LOWER MAX MIN NEXT NOT NOTHING NOW NULL NULLS OFFSET ON ONLY OR ORDER OUTER OVER PARTITION PRAGMA
  PRIMARY REFERENCES RELEASE RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SET SUM AVG TABLE THEN TO TRANSACTION TRUE
  UNION UNIQUE UPDATE UPPER USING VALUES VIEW WHEN WHERE WINDOW WITH`.split(/\s+/),
);

/** Clauses that start a new line at the query's indent; contents go on the next line, indented. */
const BLOCK_CLAUSES = [
  'SELECT DISTINCT',
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'SET',
  'VALUES',
  'RETURNING',
  'WINDOW',
];
/** Clauses on their own line with contents on the same line. */
const INLINE_CLAUSES = [
  'INSERT INTO',
  'DELETE FROM',
  'UPDATE',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'UNION ALL',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'ON CONFLICT',
  'WITH',
];
const JOINS = [
  'LEFT OUTER JOIN',
  'RIGHT OUTER JOIN',
  'FULL OUTER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'INNER JOIN',
  'CROSS JOIN',
  'JOIN',
];
/** Clauses whose top-level commas separate items that each get their own line. */
const LIST_CLAUSES = new Set(['SELECT', 'SELECT DISTINCT', 'GROUP BY', 'ORDER BY', 'SET', 'RETURNING', 'VALUES', 'FROM']);
/** Clauses where top-level AND / OR start a new line. */
const CONDITION_CLAUSES = new Set(['WHERE', 'HAVING', 'ON']);

const OPERATORS = ['<>', '<=', '>=', '!=', '::', '||', '->>', '->', '=', '<', '>', '+', '-', '*', '/', '%'];

export function tokenizeSql(sql: string): SqlToken[] {
  const out: SqlToken[] = [];
  let i = 0;
  const n = sql.length;
  const push = (type: SqlTokenType, end: number) => {
    out.push({ type, text: sql.slice(i, end) });
    i = end;
  };
  while (i < n) {
    const c = sql[i];
    const rest = sql.slice(i, i + 3);
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(sql[j])) j++;
      push('ws', j);
    } else if (rest.startsWith('--')) {
      const j = sql.indexOf('\n', i);
      push('comment', j < 0 ? n : j);
    } else if (rest.startsWith('/*')) {
      const j = sql.indexOf('*/', i + 2);
      push('comment', j < 0 ? n : j + 2);
    } else if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      push('string', Math.min(n, j + 1));
    } else if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      const j = sql.indexOf(close, i + 1);
      push('ident', j < 0 ? n : j + 1);
    } else if (c === '$' && /\d/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (j < n && /\d/.test(sql[j])) j++;
      push('param', j);
    } else if (c === '?' || ((c === ':' || c === '@') && /[A-Za-z_]/.test(sql[i + 1] ?? '') && sql[i - 1] !== ':')) {
      let j = i + 1;
      while (j < n && /[\w]/.test(sql[j])) j++;
      push('param', j);
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(sql[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && /[\d.eE]/.test(sql[j])) j++;
      push('number', j);
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      push(KEYWORDS.has(word.toUpperCase()) ? 'keyword' : 'word', j);
    } else {
      const op = OPERATORS.find((o) => sql.startsWith(o, i));
      if (op) push('op', i + op.length);
      else push('punct', i + 1);
    }
  }
  return out;
}

/** Match a multi-word clause (e.g. "LEFT OUTER JOIN") starting at significant token `k`. */
function matchPhrase(toks: SqlToken[], k: number, phrases: string[]): string | undefined {
  for (const phrase of phrases) {
    const words = phrase.split(' ');
    let ok = true;
    for (let w = 0; w < words.length; w++) {
      const t = toks[k + w];
      if (!t || (t.type !== 'keyword' && t.type !== 'word') || t.text.toUpperCase() !== words[w]) {
        ok = false;
        break;
      }
    }
    if (ok) return phrase;
  }
  return undefined;
}

const NO_SPACE_BEFORE = new Set([',', ')', '.', ';', ']']);
const NO_SPACE_AFTER = new Set(['(', '.', '[']);

/** Formatted token stream (whitespace tokens carry the new layout). */
export function formatSqlTokens(sql: string, indentUnit = '  '): SqlToken[] {
  const toks = tokenizeSql(sql).filter((t) => t.type !== 'ws');
  const out: SqlToken[] = [];
  let base = 0; // indent level of the current (sub)query
  let lineIndent = 0;
  let clause = '';
  let depth = 0; // parentheses depth inside the current (sub)query
  let betweenPending = false;
  const stack: { base: number; clause: string; depth: number; openIndent: number }[] = [];

  const last = () => out[out.length - 1];
  const newline = (level: number) => {
    while (out.length && last().type === 'ws') out.pop();
    if (out.length) out.push({ type: 'ws', text: '\n' + indentUnit.repeat(level) });
    lineIndent = level;
  };
  const space = (next: SqlToken) => {
    const prev = last();
    if (!prev || prev.type === 'ws') return;
    if (next.type === 'punct' && NO_SPACE_BEFORE.has(next.text)) return;
    if (prev.type === 'punct' && NO_SPACE_AFTER.has(prev.text)) return;
    if ((prev.type === 'op' && prev.text === '::') || (next.type === 'op' && next.text === '::')) return;
    // function call: count(…), "schema"."fn"(…) – but keep a space after keywords like IN / VALUES / AS
    // (but INSERT INTO "table" (columns…) keeps its space)
    if (next.type === 'punct' && next.text === '(' && (prev.type === 'word' || prev.type === 'ident') && clause !== 'INSERT INTO') return;
    if (
      next.type === 'punct' &&
      next.text === '(' &&
      prev.type === 'keyword' &&
      /^(COUNT|SUM|AVG|MIN|MAX|COALESCE|CAST|LOWER|UPPER|NOW)$/i.test(prev.text)
    )
      return;
    out.push({ type: 'ws', text: ' ' });
  };
  const emit = (t: SqlToken) => {
    space(t);
    out.push(t);
  };

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const word = t.type === 'keyword' || t.type === 'word' ? t.text.toUpperCase() : '';

    if (word && depth === 0) {
      const block = matchPhrase(toks, k, BLOCK_CLAUSES);
      const inline = block ? undefined : matchPhrase(toks, k, INLINE_CLAUSES);
      const join = block || inline ? undefined : matchPhrase(toks, k, JOINS);
      const phrase = block ?? inline ?? join;
      if (phrase) {
        const words = phrase.split(' ').length;
        newline(join ? base + 1 : base);
        for (let w = 0; w < words; w++) emit(toks[k + w]);
        k += words - 1;
        clause = join ? 'JOIN' : phrase;
        if (block) newline(base + 1);
        continue;
      }
      if (word === 'ON' && clause === 'JOIN') {
        emit(t);
        clause = 'ON';
        continue;
      }
      if (word === 'BETWEEN') betweenPending = true;
      if ((word === 'AND' || word === 'OR') && CONDITION_CLAUSES.has(clause)) {
        if (word === 'AND' && betweenPending) {
          betweenPending = false;
        } else {
          newline(clause === 'ON' ? base + 2 : base + 1);
          emit(t);
          continue;
        }
      }
    }

    if (t.type === 'punct' && t.text === '(') {
      const next = toks[k + 1];
      const isSubquery = next && /^(SELECT|WITH)$/i.test(next.text);
      emit(t);
      if (isSubquery) {
        stack.push({ base, clause, depth, openIndent: lineIndent });
        base = lineIndent + 1;
        depth = 0;
        clause = '';
      } else depth++;
      continue;
    }
    if (t.type === 'punct' && t.text === ')') {
      if (depth === 0 && stack.length) {
        const s = stack.pop()!;
        newline(s.openIndent);
        out.push(t);
        base = s.base;
        clause = s.clause;
        depth = s.depth;
      } else {
        depth = Math.max(0, depth - 1);
        emit(t);
      }
      continue;
    }
    if (t.type === 'punct' && t.text === ',' && depth === 0 && LIST_CLAUSES.has(clause)) {
      out.push(t);
      newline(base + 1);
      continue;
    }
    if (t.type === 'punct' && t.text === ';') {
      out.push(t);
      newline(0);
      base = 0;
      clause = '';
      continue;
    }
    emit(t);
  }
  while (out.length && last().type === 'ws') out.pop();
  return out;
}

export function formatSql(sql: string): string {
  return formatSqlTokens(sql)
    .map((t) => t.text)
    .join('');
}

const SQL_START =
  /^\s*(SELECT|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|WITH\s+\S+\s+AS|CREATE\s+(TABLE|INDEX|VIEW)|ALTER\s+TABLE|PRAGMA)\b/i;

/** Heuristic for strings inside captured values that are SQL statements. */
export function looksLikeSql(s: string): boolean {
  if (s.length < 16 || !SQL_START.test(s) || !/\s/.test(s.trim())) return false;
  // "select the best option" is English; a query selects FROM something
  return !/^\s*SELECT\b/i.test(s) || /\bFROM\b/i.test(s);
}

/**
 * One-glance label for a statement: verb plus main table, e.g. `SELECT "order"`, `INSERT "user"`.
 * Used where many SQL rows would otherwise all read "SQL.query".
 */
export function sqlSummary(sql: string): string {
  const toks = tokenizeSql(sql).filter((t) => t.type !== 'ws' && t.type !== 'comment');
  const verb = toks[0]?.text.toUpperCase();
  if (!verb) return '';
  // first table named after the keyword (skips `FROM (SELECT …)` subqueries to the inner table)
  const after = (kw: string) => {
    for (let i = 0; i < toks.length - 1; i++) {
      const t = toks[i + 1];
      if (toks[i].text.toUpperCase() === kw && (t.type === 'ident' || t.type === 'word')) return t.text;
    }
    return undefined;
  };
  const table =
    verb === 'SELECT'
      ? after('FROM')
      : verb === 'INSERT'
        ? after('INTO')
        : verb === 'UPDATE'
          ? toks[1]?.text
          : verb === 'DELETE'
            ? after('FROM')
            : undefined;
  return table ? `${verb} ${table}` : verb;
}
