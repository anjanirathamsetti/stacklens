import { getParamNames } from './param-names';
import { ctorName, HEAVY_CTORS, isPlain } from './shared';

/**
 * Infer a TypeScript-like type string for a runtime value.
 * e.g. `{ id: number; email: string; roles: string[]; createdAt: Date }`
 */
export function inferType(value: unknown, maxDepth = 3): string {
  const seen = new WeakSet<object>();

  const unionOf = (types: string[]): string => {
    const uniq = [...new Set(types)];
    if (uniq.length === 0) return 'unknown';
    if (uniq.length === 1) return uniq[0];
    if (uniq.length > 4) return 'unknown';
    return uniq.join(' | ');
  };

  const walk = (v: unknown, depth: number): string => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'undefined') return 'undefined';
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') return t;
    if (t === 'function') {
      const fn = v as Function;
      if (/^class[\s{]/.test(Function.prototype.toString.call(fn))) return `typeof ${fn.name || 'Class'}`;
      return `(${getParamNames(fn).join(', ')}) => unknown`;
    }
    const obj = v as object;
    if (seen.has(obj)) return 'Circular';
    if (obj instanceof Date) return 'Date';
    if (Buffer.isBuffer(obj)) return 'Buffer';
    if (obj instanceof Error) return obj.name || 'Error';
    if (obj instanceof Promise) return 'Promise<unknown>';
    if (obj instanceof RegExp) return 'RegExp';
    const name = ctorName(obj);
    if (name && HEAVY_CTORS.has(name)) return name;
    if (name === 'Repository' && (obj as any).metadata?.name) return `Repository<${(obj as any).metadata.name}>`;

    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        if (obj.length === 0) return 'unknown[]';
        if (depth >= maxDepth) return 'unknown[]';
        const el = unionOf(obj.slice(0, 10).map((x) => walk(x, depth + 1)));
        return el.includes(' ') && !el.startsWith('{') ? `(${el})[]` : `${el}[]`;
      }
      if (obj instanceof Map) {
        const first = obj.entries().next().value as [unknown, unknown] | undefined;
        return first ? `Map<${walk(first[0], depth + 1)}, ${walk(first[1], depth + 1)}>` : 'Map<unknown, unknown>';
      }
      if (obj instanceof Set) {
        const first = obj.values().next().value;
        return obj.size ? `Set<${walk(first, depth + 1)}>` : 'Set<unknown>';
      }
      const prefix = name && name !== 'Object' && !isPlain(obj) ? `${name} ` : '';
      if (depth >= maxDepth) return prefix ? name! : 'object';
      const keys = Object.keys(obj);
      if (keys.length === 0) return prefix ? name! : '{}';
      const fields = keys.slice(0, 20).map((k) => {
        let child: unknown;
        try {
          child = (obj as any)[k];
        } catch {
          child = undefined;
        }
        const safeKey = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
        const opt = child === undefined ? '?' : '';
        return `${safeKey}${opt}: ${child === undefined ? 'unknown' : walk(child, depth + 1)}`;
      });
      if (keys.length > 20) fields.push(`/* +${keys.length - 20} more */`);
      return `${prefix}{ ${fields.join('; ')} }`;
    } finally {
      seen.delete(obj);
    }
  };

  try {
    return walk(value, 0);
  } catch {
    return 'unknown';
  }
}
