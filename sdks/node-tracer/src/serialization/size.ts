/**
 * Approximate JSON size (bytes) of an already-serialized value. Cheap because serialized values
 * are bounded by the serializer limits (depth, keys, array length, string length); used to enforce
 * the per-trace `maxCaptureBytes` budget without calling JSON.stringify on the hot path.
 */
export function approxSize(v: unknown, depth = 0): number {
  switch (typeof v) {
    case 'string':
      return v.length + 2;
    case 'number':
      return 8;
    case 'boolean':
      return 5;
    case 'undefined':
      return 0;
  }
  if (v === null) return 4;
  if (depth > 12) return 16; // serialized values are depth-bounded; this is only a safety stop
  if (Array.isArray(v)) {
    let n = 2;
    for (const x of v) n += approxSize(x, depth + 1) + 1;
    return n;
  }
  if (typeof v === 'object') {
    let n = 2;
    for (const k in v as Record<string, unknown>) n += k.length + 4 + approxSize((v as Record<string, unknown>)[k], depth + 1);
    return n;
  }
  return 8;
}
