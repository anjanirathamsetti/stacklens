/**
 * Formatter and tokenizer for the TypeScript-like types and signatures the tracer infers, e.g.
 *   async query(query: string, parameters: string[]): Promise<QueryResult { records: unknown[]; affected: number }>
 *
 * Short things stay on one line. Long parameter lists put each parameter on its own line, and
 * object types that don't fit are expanded one member per line, recursively. Only whitespace is
 * changed.
 */

export type TypeTokenType = 'keyword' | 'primitive' | 'type' | 'key' | 'param' | 'fn' | 'string' | 'number' | 'punct' | 'op' | 'ws';
export interface TypeToken {
  type: TypeTokenType;
  text: string;
}

const KEYWORDS = new Set(['async', 'typeof', 'keyof', 'readonly', 'new', 'extends', 'infer', 'is', 'def']);
const PRIMITIVES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'object',
  'void',
  'never',
  'unknown',
  'any',
  'null',
  'undefined',
  'true',
  'false',
  // Python (the Python SDK infers types with Python names: `list[int]`, `dict[str, Any]`, `Order { id: int }`)
  'str',
  'int',
  'float',
  'bool',
  'bytes',
  'bytearray',
  'complex',
  'None',
  'Any',
  'NoReturn',
  'dict',
  'list',
  'tuple',
  'set',
  'frozenset',
]);

export function tokenizeType(src: string): TypeToken[] {
  const out: TypeToken[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out.push({ type: 'string', text: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\d._]/.test(src[j])) j++;
      out.push({ type: 'number', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      // a word followed by ":" or "?:" is a property key / parameter name
      let k = j;
      while (src[k] === ' ') k++;
      const isKey = src[k] === ':' || (src[k] === '?' && src[k + 1] === ':');
      out.push({
        type: KEYWORDS.has(word) ? 'keyword' : PRIMITIVES.has(word) ? 'primitive' : isKey ? 'key' : /^[A-Z]/.test(word) ? 'type' : 'type',
        text: word,
      });
      i = j;
      continue;
    }
    if (src.startsWith('=>', i) || src.startsWith('->', i) || src.startsWith('...', i) || src.startsWith('?:', i)) {
      const t = src.startsWith('=>', i) ? '=>' : src.startsWith('->', i) ? '->' : src.startsWith('...', i) ? '...' : '?:';
      out.push({ type: t === '...' ? 'punct' : 'op', text: t });
      i += t.length;
      continue;
    }
    out.push({ type: c === '|' || c === '&' ? 'op' : 'punct', text: c });
    i++;
  }
  return out;
}

const OPEN: Record<string, string> = { '{': '}', '(': ')', '[': ']', '<': '>' };

/** Index of the bracket closing the one at `i`. */
function matching(toks: TypeToken[], i: number): number {
  const open = toks[i].text;
  const close = OPEN[open];
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j].type !== 'punct') continue;
    if (toks[j].text === open) depth++;
    else if (toks[j].text === close && --depth === 0) return j;
  }
  return toks.length - 1;
}

/** Split [from, to) at top-level separators (`;` or `,`), dropping a trailing empty part. */
function splitTop(toks: TypeToken[], from: number, to: number, seps: string[]): [number, number][] {
  const parts: [number, number][] = [];
  let start = from;
  for (let j = from; j < to; j++) {
    const t = toks[j];
    if (t.type === 'punct' && OPEN[t.text]) {
      j = matching(toks, j);
      continue;
    }
    if (t.type === 'punct' && seps.includes(t.text)) {
      parts.push([start, j]);
      start = j + 1;
    }
  }
  if (start < to) parts.push([start, to]);
  return parts;
}

const NO_SPACE_BEFORE = new Set([',', ';', ')', ']', '>', '?', '.', ':', '[', '(', '<']);
const NO_SPACE_AFTER = new Set(['(', '[', '<', '.', '...']);

/** One-line rendering of a token range (used to measure and for short types). */
function inline(toks: TypeToken[], from: number, to: number): TypeToken[] {
  const out: TypeToken[] = [];
  for (let j = from; j < to; j++) {
    const t = toks[j];
    const prev = out[out.length - 1];
    if (prev) {
      const brace = (t.type === 'punct' && t.text === '}') || (prev.type === 'punct' && prev.text === '{');
      const noSpace =
        (t.type === 'punct' && NO_SPACE_BEFORE.has(t.text) && !brace) ||
        (t.type === 'op' && t.text === '?:') ||
        (prev.type === 'punct' && NO_SPACE_AFTER.has(prev.text));
      // `T[]` and `Promise<` stay tight; `{ a: T }` gets inner spaces
      if (!noSpace) out.push({ type: 'ws', text: ' ' });
    }
    out.push(t);
  }
  return out;
}

const textOf = (toks: TypeToken[]) => toks.map((t) => t.text).join('');

/**
 * Format [from, to), breaking object literals that don't fit in `width` columns at `indent`.
 * `offset` is how much of the first line is already taken by text before the type.
 */
function layout(toks: TypeToken[], from: number, to: number, indent: number, width: number, unit: string, offset = 0): TypeToken[] {
  const flat = inline(toks, from, to);
  if (indent * unit.length + offset + textOf(flat).length <= width) return flat;
  const out: TypeToken[] = [];
  let j = from;
  let segStart = from;
  const flush = (end: number) => {
    if (end > segStart) {
      const seg = inline(toks, segStart, end);
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.type !== 'ws' &&
        !(prev.type === 'punct' && NO_SPACE_AFTER.has(prev.text)) &&
        !(seg[0]?.type === 'punct' && NO_SPACE_BEFORE.has(seg[0].text))
      )
        out.push({ type: 'ws', text: ' ' });
      out.push(...seg);
    }
  };
  while (j < to) {
    const t = toks[j];
    if (t.type === 'punct' && t.text === '{') {
      const end = matching(toks, j);
      flush(j);
      const prev = out[out.length - 1];
      if (prev && prev.type !== 'ws' && !(prev.type === 'punct' && NO_SPACE_AFTER.has(prev.text))) out.push({ type: 'ws', text: ' ' });
      out.push(t);
      for (const [a, b] of splitTop(toks, j + 1, end, [';', ','])) {
        out.push({ type: 'ws', text: '\n' + unit.repeat(indent + 1) });
        out.push(...layout(toks, a, b, indent + 1, width, unit, 0));
        out.push({ type: 'punct', text: ';' });
      }
      out.push({ type: 'ws', text: '\n' + unit.repeat(indent) });
      out.push(toks[end]);
      j = end + 1;
      segStart = j;
      continue;
    }
    j++;
  }
  flush(to);
  return out;
}

export function formatTypeTokens(type: string, width = 64, indent = 0, unit = '  ', offset = 0): TypeToken[] {
  const toks = tokenizeType(type);
  return layout(toks, 0, toks.length, indent, width, unit, offset);
}

export function formatType(type: string, width = 64): string {
  return textOf(formatTypeTokens(type, width));
}

export interface SignatureParts {
  name: string;
  params: { name: string; type?: string }[];
  returnType: string;
  async?: boolean;
  /** `python` renders `async def name(a: A) -> R`; otherwise TypeScript style `async name(a: A): R`. */
  language?: 'node' | 'python';
}

/** `async name(a: A, b: B): R` (or `async def name(a: A, b: B) -> R` for Python), with parameters on their own lines when it doesn't fit. */
export function formatSignatureTokens(sig: SignatureParts, width = 64, unit = '  '): TypeToken[] {
  const py = sig.language === 'python';
  const head: TypeToken[] = [];
  if (sig.async) head.push({ type: 'keyword', text: 'async' }, { type: 'ws', text: ' ' });
  if (py) head.push({ type: 'keyword', text: 'def' }, { type: 'ws', text: ' ' });
  head.push({ type: 'fn', text: sig.name }, { type: 'punct', text: '(' });
  const param = (p: SignatureParts['params'][number], indent: number): TypeToken[] => [
    { type: 'param', text: p.name },
    { type: 'punct', text: ':' },
    { type: 'ws', text: ' ' },
    ...formatTypeTokens(p.type ?? 'unknown', width, indent, unit),
  ];
  const ret = (offset: number): TypeToken[] => [
    { type: 'punct', text: ')' },
    ...(py
      ? [{ type: 'ws', text: ' ' } as TypeToken, { type: 'op', text: '->' } as TypeToken]
      : [{ type: 'punct', text: ':' } as TypeToken]),
    { type: 'ws', text: ' ' },
    ...formatTypeTokens(sig.returnType, width, 0, unit, offset + (py ? 5 : 3)),
  ];
  // parameters on the same line as the name when they fit; the return type then breaks if it must
  const inlineHead: TypeToken[] = [...head];
  sig.params.forEach((p, i) => {
    if (i) inlineHead.push({ type: 'punct', text: ',' }, { type: 'ws', text: ' ' });
    inlineHead.push(...param(p, 0));
  });
  const headText = textOf(inlineHead);
  if (sig.params.length === 0 || (!headText.includes('\n') && headText.length + 3 <= width)) {
    return [...inlineHead, ...ret(headText.length)];
  }
  const out: TypeToken[] = [...head];
  for (const p of sig.params) {
    out.push({ type: 'ws', text: '\n' + unit }, ...param(p, 1), { type: 'punct', text: ',' });
  }
  out.push({ type: 'ws', text: '\n' }, ...ret(0));
  return out;
}

export function formatSignature(sig: SignatureParts, width = 64): string {
  return textOf(formatSignatureTokens(sig, width));
}
