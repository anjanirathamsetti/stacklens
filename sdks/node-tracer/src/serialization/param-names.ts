const paramCache = new WeakMap<Function, string[]>();

/** Best-effort extraction of parameter names from a function's source. */
export function getParamNames(fn: Function): string[] {
  const cached = paramCache.get(fn);
  if (cached) return cached;
  let names: string[] = [];
  try {
    const src = Function.prototype.toString.call(fn);
    const start = src.indexOf('(');
    const arrow = src.indexOf('=>');
    // single-param arrow without parens: `x => …`
    if (arrow !== -1 && (start === -1 || start > arrow)) {
      const m = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(src.trim());
      names = m ? [m[1]] : [];
    } else if (start !== -1) {
      let depth = 0;
      let end = start;
      for (let i = start; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const inner = src
        .slice(start + 1, end)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const parts: string[] = [];
      let buf = '';
      depth = 0;
      for (const ch of inner) {
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        if (ch === ')' || ch === '}' || ch === ']') depth--;
        if (ch === ',' && depth === 0) {
          parts.push(buf);
          buf = '';
        } else buf += ch;
      }
      if (buf.trim()) parts.push(buf);
      names = parts
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          if (p.startsWith('{')) return '{…}';
          if (p.startsWith('[')) return '[…]';
          return p.split('=')[0].trim();
        });
    }
  } catch {
    names = [];
  }
  paramCache.set(fn, names);
  return names;
}
