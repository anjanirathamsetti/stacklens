import type { TraceParent } from '../types';

/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/) helpers.
 *
 * StackLens trace ids are 16 random bytes (32 hex) and span ids 8 bytes (16 hex) – the same widths
 * as `traceparent`, so ids are passed through unchanged. The callee keeps its own trace id and
 * records the caller as `parent`; the server joins the two trees at read time.
 */

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(?:-.*)?$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const ZERO = /^0+$/;

/** Name of our entry in the `tracestate` header. */
export const TRACESTATE_KEY = 'stacklens';

/** `00-<trace id>-<span id>-01`. Ids that aren't already W3C-shaped are hashed into shape. */
export function formatTraceparent(traceId: string, spanId: string): string {
  return `00-${toHex(traceId, 32)}-${toHex(spanId, 16)}-01`;
}

/** Parse an incoming `traceparent`; `undefined` when missing or invalid (all-zero ids, version ff). */
export function parseTraceparent(header: unknown): { traceId: string; spanId: string } | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;
  const m = TRACEPARENT.exec(value.trim().toLowerCase());
  if (!m || m[1] === 'ff' || (m[1] === '00' && value.trim().length !== 55)) return undefined;
  if (ZERO.test(m[2]) || ZERO.test(m[3])) return undefined;
  return { traceId: m[2], spanId: m[3] };
}

/** `stacklens=<application>` – lets the callee show who called it without a server round trip. */
export function formatTracestate(application: string): string {
  // values: printable ASCII except "," and "=", at most 256 chars, no trailing space
  const value = application
    .replace(/[^\x20-\x7e]|[,=]/g, '_')
    .slice(0, 256)
    .trimEnd();
  return value ? `${TRACESTATE_KEY}=${value}` : '';
}

/** Our application name from a (possibly multi-vendor) `tracestate` header. */
export function parseTracestate(header: unknown): string | undefined {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (typeof value !== 'string') return undefined;
  for (const member of value.split(',')) {
    const eq = member.indexOf('=');
    if (eq > 0 && member.slice(0, eq).trim() === TRACESTATE_KEY) return member.slice(eq + 1).trim() || undefined;
  }
  return undefined;
}

/** The caller recorded on a trace started by an incoming request. */
export function parentFromHeaders(headers: Record<string, unknown> | undefined): TraceParent | undefined {
  if (!headers) return undefined;
  const tp = parseTraceparent(headers['traceparent']);
  if (!tp) return undefined;
  const service = parseTracestate(headers['tracestate']);
  return service ? { ...tp, service } : tp;
}

/** Hosts (exact, or `.suffix` for subdomains) or RegExps tested against `hostname` and `hostname:port`. */
export function hostMatcher(list: (string | RegExp)[] | undefined): (hostname: string, host: string) => boolean {
  if (!list) return () => true;
  return (hostname, host) =>
    list.some((p) => {
      if (typeof p !== 'string') return p.test(host) || p.test(hostname);
      const want = p.toLowerCase();
      if (want.startsWith('.')) return hostname.endsWith(want) || hostname === want.slice(1);
      return want === hostname || want === host;
    });
}

function toHex(id: string, width: number): string {
  const lower = id.toLowerCase();
  if ((width === 32 ? HEX32 : HEX16).test(lower) && !ZERO.test(lower)) return lower;
  if (/^[0-9a-f]+$/.test(lower) && lower.length < width && !ZERO.test(lower)) return lower.padStart(width, '0');
  // custom ids (non-hex or too long): a stable FNV-1a hash, repeated to the width
  let out = '';
  let h = 0x811c9dc5;
  while (out.length < width) {
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ out.length, 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  out = out.slice(0, width);
  return ZERO.test(out) ? '1'.padStart(width, '0') : out;
}

export const isW3cTraceId = (id: string): boolean => HEX32.test(id) && !ZERO.test(id);
