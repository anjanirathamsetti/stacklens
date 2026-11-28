/**
 * Small syntax highlighter for the code shown in the app (setup snippets): TypeScript / JavaScript,
 * Python, shell and .env files. It only classifies text; joining the tokens always gives the source back.
 */

export type CodeLanguage = 'ts' | 'js' | 'python' | 'bash' | 'env';

export type CodeTokenType =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'constant'
  | 'decorator'
  | 'function'
  | 'type'
  | 'property'
  | 'variable'
  | 'flag'
  | 'punct'
  | 'plain';

export interface CodeToken {
  type: CodeTokenType;
  text: string;
}

type Rule = [CodeTokenType | ((text: string, rest: string, before: string) => CodeTokenType), RegExp];

const words = (list: string) => new Set(list.split(' '));

const JS_KEYWORDS = words(
  'import from export default const let var function return async await class extends new if else for of in try catch finally throw typeof instanceof interface type implements public private readonly static',
);
const PY_KEYWORDS = words(
  'import from as def class return async await if elif else for in not and or is with try except finally raise lambda pass yield global while break continue assert del nonlocal',
);
const SHELL_COMMANDS = words('npm npx pip pip3 python python3 git cd export curl node docker celery uvicorn flask');

/** An identifier, classified by what surrounds it. */
function identifier(keywords: Set<string>, constants: Set<string>) {
  return (text: string, rest: string, before: string): CodeTokenType => {
    if (keywords.has(text)) return 'keyword';
    if (constants.has(text)) return 'constant';
    if (/^\s*\(/.test(rest)) return /^[A-Z]/.test(text) ? 'type' : 'function';
    // object keys (`name: value`) and keyword arguments (`name=value`) right after `{ ( ,`
    if (/(^|[{(,])\s*$/.test(before) && /^\s*(:(?!:)|=(?![=>]))/.test(rest)) return 'property';
    if (/^[A-Z][a-z0-9]/.test(text)) return 'type';
    return 'plain';
  };
}

const JS_RULES: Rule[] = [
  ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
  ['string', /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/y],
  ['string', /\/(?![/*\s])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[a-z]*(?=\s*[,\])])/y],
  ['decorator', /@[A-Za-z_$][\w$]*/y],
  ['number', /\b\d[\d_]*(?:\.\d+)?\b/y],
  [identifier(JS_KEYWORDS, words('true false null undefined this')), /[A-Za-z_$][\w$]*/y],
  ['punct', /[{}()[\];,.:?=+\-*/<>!&|]+?/y],
];

const PY_RULES: Rule[] = [
  ['comment', /#[^\n]*/y],
  ['string', /[rbfRBF]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/y],
  ['decorator', /@[A-Za-z_][\w.]*/y],
  ['number', /\b\d[\d_]*(?:\.\d+)?\b/y],
  [identifier(PY_KEYWORDS, words('True False None self')), /[A-Za-z_]\w*/y],
  ['punct', /[{}()[\];,.:=+\-*/<>!&|%]/y],
];

const BASH_RULES: Rule[] = [
  ['comment', /(?<=^|\s)#[^\n]*/my],
  ['string', /'[^'\n]*'|"(?:\\.|[^"\\\n])*"/y],
  ['variable', /\$\{?[A-Za-z_]\w*\}?|\b[A-Z][A-Z0-9_]{2,}(?==)/y],
  ['flag', /(?<=\s)--?[A-Za-z][\w-]*/y],
  [
    (text, _rest, before) => (SHELL_COMMANDS.has(text) && /(^|\n|&&|\||;)\s*$/.test(before) ? 'function' : 'plain'),
    /[A-Za-z_][\w./@~:-]*/y,
  ],
  ['punct', /&&|\|\||[|;=\\]/y],
];

const ENV_RULES: Rule[] = [
  ['comment', /^[ \t]*#[^\n]*/my],
  ['variable', /^[A-Z_][A-Z0-9_]*(?==)/my],
  ['punct', /=/y],
  ['string', /(?<==)[^\n]+/y],
];

const RULES: Record<CodeLanguage, Rule[]> = { ts: JS_RULES, js: JS_RULES, python: PY_RULES, bash: BASH_RULES, env: ENV_RULES };

export function highlight(code: string, language: CodeLanguage): CodeToken[] {
  const rules = RULES[language];
  const out: CodeToken[] = [];
  const push = (type: CodeTokenType, text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  outer: while (i < code.length) {
    for (const [kind, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (!m || !m[0]) continue;
      const text = m[0];
      const type =
        typeof kind === 'function'
          ? kind(text, code.slice(i + text.length, i + text.length + 40), code.slice(Math.max(0, i - 40), i))
          : kind;
      push(type, text);
      i += text.length;
      continue outer;
    }
    push('plain', code[i]);
    i++;
  }
  return out;
}

/** Tokens split at line breaks, one array per line (multi-line strings and comments keep their colour). */
export function highlightLines(code: string, language: CodeLanguage): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of highlight(code, language)) {
    token.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ type: token.type, text: part });
    });
  }
  return lines;
}
