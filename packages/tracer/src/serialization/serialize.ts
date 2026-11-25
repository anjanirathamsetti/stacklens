import { ctorName, HEAVY_CTORS, isPlain, summarizeHeavy, type SerializeLimits } from './shared';

/**
 * Bounded, circular-safe copy of any runtime value as renderable JSON.
 * Reference implementation – the hot path uses `capture()`, which returns the same output.
 */
export function serialize(value: unknown, limits: SerializeLimits): unknown {
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): unknown => {
    switch (typeof v) {
      case 'string':
        return v.length > limits.maxStringLength
          ? v.slice(0, limits.maxStringLength) + `… (+${v.length - limits.maxStringLength} chars)`
          : v;
      case 'number':
        return Number.isFinite(v) ? v : String(v);
      case 'boolean':
        return v;
      case 'bigint':
        return `${v.toString()}n`;
      case 'symbol':
        return v.toString();
      case 'undefined':
        return { $t: 'undefined' };
      case 'function':
        return { $t: 'fn', name: (v as Function).name || 'anonymous' };
    }
    if (v === null) return null;
    const obj = v as object;

    if (seen.has(obj)) return { $t: 'circular' };
    if (obj instanceof Date) return { $t: 'Date', v: isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString() };
    if (Buffer.isBuffer(obj)) return { $t: 'Buffer', length: obj.length };
    if (obj instanceof Error) {
      return { $t: 'Error', name: obj.name, message: obj.message, stack: obj.stack };
    }
    if (obj instanceof Promise) return { $t: 'Promise' };
    if (obj instanceof RegExp) return obj.toString();
    if (ArrayBuffer.isView(obj)) return { $t: 'ref', name: ctorName(obj) ?? 'TypedArray', summary: `length ${(obj as any).length}` };

    const name = ctorName(obj);
    if (name && (HEAVY_CTORS.has(name) || name === 'Repository')) return summarizeHeavy(name, obj);
    if (typeof (obj as any).subscribe === 'function' && typeof (obj as any).pipe === 'function') {
      return { $t: 'ref', name: name ?? 'Observable' };
    }

    if (depth >= limits.maxDepth) {
      if (Array.isArray(obj)) return { $t: 'more', count: obj.length, kind: 'array' };
      return { $t: 'ref', name: name ?? 'Object', summary: '…' };
    }

    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        const out = obj.slice(0, limits.maxArrayLength).map((x) => walk(x, depth + 1));
        if (obj.length > limits.maxArrayLength) out.push({ $t: 'more', count: obj.length - limits.maxArrayLength });
        return out;
      }
      if (obj instanceof Map) {
        const entries: unknown[] = [];
        let i = 0;
        for (const [k, val] of obj) {
          if (i++ >= limits.maxArrayLength) break;
          entries.push([walk(k, depth + 1), walk(val, depth + 1)]);
        }
        return { $t: 'Map', size: obj.size, entries };
      }
      if (obj instanceof Set) {
        const values: unknown[] = [];
        let i = 0;
        for (const val of obj) {
          if (i++ >= limits.maxArrayLength) break;
          values.push(walk(val, depth + 1));
        }
        return { $t: 'Set', size: obj.size, values };
      }

      // Respect toJSON (e.g. Decimal, ObjectId, moment)
      if (!isPlain(obj) && typeof (obj as any).toJSON === 'function') {
        try {
          return walk((obj as any).toJSON(), depth);
        } catch {
          /* fall through */
        }
      }

      const out: Record<string, unknown> = {};
      if (name && name !== 'Object' && !isPlain(obj)) out.$class = name;
      const keys = Object.keys(obj);
      let count = 0;
      for (const key of keys) {
        if (count++ >= limits.maxObjectKeys) {
          out['…'] = { $t: 'more', count: keys.length - limits.maxObjectKeys };
          break;
        }
        if (limits.redact(key)) {
          out[key] = '[REDACTED]';
          continue;
        }
        let child: unknown;
        try {
          child = (obj as any)[key];
        } catch (e) {
          child = `[getter threw: ${(e as Error)?.message}]`;
        }
        out[key] = walk(child, depth + 1);
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  };

  try {
    return walk(value, 0);
  } catch (e) {
    return `[unserializable: ${(e as Error)?.message}]`;
  }
}
