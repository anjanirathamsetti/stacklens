// Dependency-free validator for the subset of JSON Schema used by trace.schema.json
// (type, enum, required, properties, additionalProperties, items, oneOf, $ref, minimum, minLength).
// Usable from any toolchain that can run Node: `node sdks/conformance/check.mjs payload.json`.
import { readFileSync } from 'node:fs';

export const schema = JSON.parse(readFileSync(new URL('./trace.schema.json', import.meta.url), 'utf8'));

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const matchesType = (v, t) => typeOf(v) === t || (t === 'number' && typeOf(v) === 'integer');

function resolve(ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => node[key], schema);
}

function check(node, value, path, errors) {
  if (node.$ref) return check(resolve(node.$ref), value, path, errors);
  if (node.oneOf) {
    const results = node.oneOf.map((n) => {
      const e = [];
      check(n, value, path, e);
      return e;
    });
    const ok = results.filter((e) => e.length === 0).length;
    if (ok !== 1)
      errors.push(...(ok === 0 ? results.reduce((a, b) => (a.length <= b.length ? a : b)) : [`${path}: matches more than one schema`]));
    return;
  }
  if (node.type) {
    const types = [].concat(node.type);
    if (!types.some((t) => matchesType(value, t))) return void errors.push(`${path}: expected ${types.join(' | ')}, got ${typeOf(value)}`);
  }
  if (node.enum && !node.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${node.enum.join(', ')}`);
  if (typeof value === 'number' && node.minimum !== undefined && value < node.minimum) errors.push(`${path}: ${value} < ${node.minimum}`);
  if (typeof value === 'string' && node.minLength !== undefined && value.length < node.minLength)
    errors.push(`${path}: shorter than ${node.minLength}`);
  if (typeOf(value) === 'array' && node.items) value.forEach((v, i) => check(node.items, v, `${path}[${i}]`, errors));
  if (typeOf(value) === 'object') {
    for (const key of node.required ?? []) if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    for (const [key, v] of Object.entries(value)) {
      if (node.properties?.[key]) check(node.properties[key], v, `${path}.${key}`, errors);
      else if (node.additionalProperties === false) errors.push(`${path}: unknown property "${key}"`);
    }
  }
}

/** Validate a value against a definition ("IngestRequest", "TraceRecord", …) or the root schema. Returns error strings. */
export function validate(value, def) {
  const errors = [];
  check(def ? schema.$defs[def] : schema, value, '$', errors);
  return errors;
}
