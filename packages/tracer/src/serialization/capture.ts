import { inferType } from './infer-type';
import { getParamNames } from './param-names';
import { serialize } from './serialize';
import { ctorName, HEAVY_CTORS, isPlain, summarizeHeavy, type SerializeLimits } from './shared';

const TYPE_DEPTH = 3;
const TYPE_ARRAY_SAMPLE = 10;
const TYPE_MAX_KEYS = 20;
const SAFE_KEY = /^[A-Za-z_$][\w$]*$/;

function unionOf(types: string[]): string {
  const uniq = [...new Set(types)];
  if (uniq.length === 0) return 'unknown';
  if (uniq.length === 1) return uniq[0];
  if (uniq.length > 4) return 'unknown';
  return uniq.join(' | ');
}

function fnType(fn: Function): string {
  if (/^class[\s{]/.test(Function.prototype.toString.call(fn))) return `typeof ${fn.name || 'Class'}`;
  return `(${getParamNames(fn).join(', ')}) => unknown`;
}

/**
 * Produces exactly what `serialize()` and `inferType()` return, but walks the value once
 * instead of twice. This is the hot path: it runs inline for every argument and return
 * value of every instrumented call.
 */
export function capture(value: unknown, limits: SerializeLimits, withType: boolean): { value: unknown; type?: string } {
  const seen = new WeakSet<object>();

  // walk() returns the serialized value and leaves the inferred type in `lastT` (read it right
  // after the call). Avoids allocating a [value, type] pair for every node. S / T say which
  // halves the caller needs.
  let lastT: string | undefined;
  const ret = (s: unknown, t: string | undefined) => {
    lastT = t;
    return s;
  };
  const walk = (v: unknown, depth: number, S: boolean, T: boolean): unknown => {
    switch (typeof v) {
      case 'string':
        return ret(
          S
            ? v.length > limits.maxStringLength
              ? v.slice(0, limits.maxStringLength) + `… (+${v.length - limits.maxStringLength} chars)`
              : v
            : undefined,
          'string',
        );
      case 'number':
        return ret(Number.isFinite(v) ? v : String(v), 'number');
      case 'boolean':
        return ret(v, 'boolean');
      case 'bigint':
        return ret(`${v.toString()}n`, 'bigint');
      case 'symbol':
        return ret(v.toString(), 'symbol');
      case 'undefined':
        return ret({ $t: 'undefined' }, 'undefined');
      case 'function':
        return ret(S ? { $t: 'fn', name: (v as Function).name || 'anonymous' } : undefined, T ? fnType(v as Function) : undefined);
    }
    if (v === null) return ret(null, 'null');
    const obj = v as object;

    if (seen.has(obj)) return ret({ $t: 'circular' }, 'Circular');
    if (obj instanceof Date)
      return ret(S ? { $t: 'Date', v: isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString() } : undefined, 'Date');
    if (Buffer.isBuffer(obj)) return ret({ $t: 'Buffer', length: obj.length }, 'Buffer');
    if (obj instanceof Error)
      return ret(S ? { $t: 'Error', name: obj.name, message: obj.message, stack: obj.stack } : undefined, obj.name || 'Error');
    if (obj instanceof Promise) return ret({ $t: 'Promise' }, 'Promise<unknown>');
    if (obj instanceof RegExp) return ret(obj.toString(), 'RegExp');

    const name = ctorName(obj);

    // serialize-only short circuits
    let s: unknown;
    let sDone = false;
    if (S) {
      if (ArrayBuffer.isView(obj)) {
        s = { $t: 'ref', name: name ?? 'TypedArray', summary: `length ${(obj as any).length}` };
        sDone = true;
      } else if (name && (HEAVY_CTORS.has(name) || name === 'Repository')) {
        s = summarizeHeavy(name, obj);
        sDone = true;
      } else if (typeof (obj as any).subscribe === 'function' && typeof (obj as any).pipe === 'function') {
        s = { $t: 'ref', name: name ?? 'Observable' };
        sDone = true;
      } else if (depth >= limits.maxDepth) {
        s = Array.isArray(obj) ? { $t: 'more', count: obj.length, kind: 'array' } : { $t: 'ref', name: name ?? 'Object', summary: '…' };
        sDone = true;
      }
    }
    // type-only short circuits
    let t: string | undefined;
    let tDone = false;
    if (T) {
      if (name && HEAVY_CTORS.has(name)) {
        t = name;
        tDone = true;
      } else if (name === 'Repository' && (obj as any).metadata?.name) {
        t = `Repository<${(obj as any).metadata.name}>`;
        tDone = true;
      }
    }
    const needS = S && !sDone;
    const needT = T && !tDone;
    if (!needS && !needT) return ret(s, t);
    // one half finished early – finish the other on its own
    if (S && T && needS !== needT) {
      if (needS) {
        const sv = walk(v, depth, true, false);
        return ret(sv, t);
      }
      walk(v, depth, false, true);
      return ret(s, lastT);
    }

    // serialize honours toJSON (Decimal, ObjectId, moment…); type inference looks at the object itself
    if (needS && !isPlain(obj) && typeof (obj as any).toJSON === 'function') {
      let j: unknown;
      let ok = true;
      try {
        j = (obj as any).toJSON();
      } catch {
        ok = false;
      }
      if (ok) {
        // match serialize(): the object counts as "seen" while its toJSON() output is walked
        seen.add(obj);
        let js: unknown;
        try {
          js = walk(j, depth, true, false);
        } finally {
          seen.delete(obj);
        }
        if (!needT) return ret(js, undefined);
        walk(v, depth, false, true);
        return ret(js, lastT);
      }
    }

    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        const sLen = needS ? Math.min(obj.length, limits.maxArrayLength) : 0;
        const typeKids = needT && obj.length > 0 && depth < TYPE_DEPTH;
        const tLen = typeKids ? Math.min(obj.length, TYPE_ARRAY_SAMPLE) : 0;
        const out: unknown[] | undefined = needS ? [] : undefined;
        const types: string[] = [];
        for (let i = 0; i < Math.max(sLen, tLen); i++) {
          const cs = walk(obj[i], depth + 1, i < sLen, i < tLen);
          const ct = lastT;
          if (i < sLen) out!.push(cs);
          if (i < tLen) types.push(ct!);
        }
        if (needS && obj.length > limits.maxArrayLength) out!.push({ $t: 'more', count: obj.length - limits.maxArrayLength });
        let type: string | undefined;
        if (needT) {
          if (!typeKids) type = 'unknown[]';
          else {
            const el = unionOf(types);
            type = el.includes(' ') && !el.startsWith('{') ? `(${el})[]` : `${el}[]`;
          }
        }
        return ret(out, type);
      }

      if (obj instanceof Map) {
        const entries: unknown[] = [];
        let type: string | undefined = needT ? 'Map<unknown, unknown>' : undefined;
        let i = 0;
        for (const [k, val] of obj) {
          const wantS = needS && i < limits.maxArrayLength;
          const wantT = needT && i === 0;
          if (!wantS && !wantT) break;
          const ks = walk(k, depth + 1, wantS, wantT);
          const kt = lastT;
          const vs = walk(val, depth + 1, wantS, wantT);
          const vt = lastT;
          if (wantS) entries.push([ks, vs]);
          if (wantT) type = `Map<${kt}, ${vt}>`;
          i++;
        }
        return ret(needS ? { $t: 'Map', size: obj.size, entries } : undefined, type);
      }

      if (obj instanceof Set) {
        const values: unknown[] = [];
        let type: string | undefined = needT ? 'Set<unknown>' : undefined;
        let i = 0;
        for (const val of obj) {
          const wantS = needS && i < limits.maxArrayLength;
          const wantT = needT && i === 0;
          if (!wantS && !wantT) break;
          const vs = walk(val, depth + 1, wantS, wantT);
          const vt = lastT;
          if (wantS) values.push(vs);
          if (wantT) type = `Set<${vt}>`;
          i++;
        }
        return ret(needS ? { $t: 'Set', size: obj.size, values } : undefined, type);
      }

      const isClassInstance = !!name && name !== 'Object' && !isPlain(obj);
      const keys = Object.keys(obj);
      const out: Record<string, unknown> | undefined = needS ? {} : undefined;
      if (out && isClassInstance) out.$class = name;
      const typeKids = needT && depth < TYPE_DEPTH && keys.length > 0;
      const sLen = needS ? Math.min(keys.length, limits.maxObjectKeys) : 0;
      const tLen = typeKids ? Math.min(keys.length, TYPE_MAX_KEYS) : 0;
      const fields: string[] = [];
      for (let i = 0; i < Math.max(sLen, tLen); i++) {
        const key = keys[i];
        let wantS = i < sLen;
        const wantT = i < tLen;
        if (wantS && limits.redact(key)) {
          out![key] = '[REDACTED]';
          wantS = false;
        }
        let child: unknown;
        let threw: unknown = null;
        try {
          child = (obj as any)[key];
        } catch (e) {
          threw = e;
        }
        if (threw !== null) {
          if (wantS) out![key] = `[getter threw: ${(threw as Error)?.message}]`;
          if (wantT) fields.push(`${SAFE_KEY.test(key) ? key : JSON.stringify(key)}?: unknown`);
          continue;
        }
        const typeChild = wantT && child !== undefined;
        if (!wantS && !typeChild) {
          if (wantT) fields.push(`${SAFE_KEY.test(key) ? key : JSON.stringify(key)}?: unknown`);
          continue;
        }
        const cs = walk(child, depth + 1, wantS, typeChild);
        const ct = lastT;
        if (wantS) out![key] = cs;
        if (wantT) {
          const safeKey = SAFE_KEY.test(key) ? key : JSON.stringify(key);
          fields.push(child === undefined ? `${safeKey}?: unknown` : `${safeKey}: ${ct}`);
        }
      }
      if (out && keys.length > limits.maxObjectKeys) out['…'] = { $t: 'more', count: keys.length - limits.maxObjectKeys };

      let type: string | undefined;
      if (needT) {
        const prefix = isClassInstance ? `${name} ` : '';
        if (depth >= TYPE_DEPTH) type = prefix ? name! : 'object';
        else if (keys.length === 0) type = prefix ? name! : '{}';
        else {
          if (keys.length > TYPE_MAX_KEYS) fields.push(`/* +${keys.length - TYPE_MAX_KEYS} more */`);
          type = `${prefix}{ ${fields.join('; ')} }`;
        }
      }
      return ret(out, type);
    } finally {
      seen.delete(obj);
    }
  };

  try {
    const s = walk(value, 0, true, withType);
    return withType ? { value: s, type: lastT } : { value: s };
  } catch {
    // extremely defensive: fall back to the two independent walkers
    return withType ? { value: serialize(value, limits), type: inferType(value) } : { value: serialize(value, limits) };
  }
}
