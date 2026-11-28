import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { originalConsole } from '../core/console';
import { traceContext, type TraceContext } from '../core/context';
import { formatTraceparent, formatTracestate } from '../core/propagation';
import { tracer, type CallHandle } from '../core/tracer';
import type { SpanRecord } from '../types';

/**
 * Outgoing HTTP calls: one span per request (kind `http`) with method, URL, headers, bodies and
 * status, plus W3C `traceparent` propagation so an instrumented callee links its trace to that span.
 *
 * Covers `http.request/get`, `https.request/get` (and so axios, got, node-fetch, …) and the global
 * `fetch` (undici, which does not go through `node:http`). Calls that are already inside an outgoing
 * span – a fetch polyfill built on `http` – are not recorded twice.
 *
 * Nothing here may break the request: every step is guarded, and the caller's arguments, events
 * and stream behaviour are left as they were (no listeners are added; events are observed by
 * wrapping `emit`, the body by wrapping `write`/`end`/`push`).
 */

/** Response header an instrumented callee sets to its own trace id (see the Express middleware). */
export const TRACE_ID_HEADER = 'x-stacklens-trace-id';
/** Bodies beyond this many bytes are not kept (the serializer trims further to `maxStringLength`). */
const MAX_BODY_BYTES = 64 * 1024;
const TEXTUAL = /json|text|xml|x-www-form-urlencoded|graphql|javascript/i;

const kPatched = Symbol.for('stacklens.httpClient.patched');

interface Target {
  method: string;
  url: URL;
}

/** One outgoing call in flight. */
interface Outgoing {
  ctx: TraceContext;
  handle?: CallHandle;
  method: string;
  url: string;
  /** headers to inject; undefined = don't propagate */
  inject?: Record<string, string>;
  done: boolean;
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

const active = () => tracer.opts.enabled && (tracer.opts.captureOutbound || tracer.opts.propagate);

/** Current trace, unless there is none, it was exported, or we are already inside an outgoing span. */
function currentContext(): TraceContext | undefined {
  const ctx = traceContext.getStore();
  if (!ctx || ctx.trace.finished || !active()) return undefined;
  if (ctx.trace.byId.get(ctx.spanId)?.outbound) return undefined;
  return ctx;
}

/** Requests to the StackLens collector itself are never traced. */
function isCollector(url: URL): boolean {
  try {
    const c = new URL(tracer.opts.endpoint);
    return c.host === url.host && url.pathname.startsWith(c.pathname);
  } catch {
    return false;
  }
}

/** `/orders/42/items/9f86d081884c7d65` → `/orders/:id/items/:id`, so loops over ids group together. */
export function routeOf(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
      (/^[0-9a-f]{8,}$/i.test(seg) && /\d/.test(seg)) ||
      (seg.length >= 16 && /\d/.test(seg) && /^[\w-]+$/.test(seg))
        ? ':id'
        : seg,
    )
    .join('/');
}

/** Absolute URL without credentials; values of secret-looking query keys are replaced. */
export function redactUrl(url: URL): string {
  const u = new URL(url.href);
  u.username = '';
  u.password = '';
  u.hash = '';
  if (u.search) {
    const parts: string[] = [];
    for (const [k, v] of u.searchParams) {
      parts.push(`${encodeURIComponent(k)}=${tracer.limits.redact(k) ? '[REDACTED]' : encodeURIComponent(v)}`);
    }
    u.search = parts.length ? `?${parts.join('&')}` : '';
  }
  return u.href;
}

function begin(ctx: TraceContext, t: Target, alreadyHasTraceparent: boolean): Outgoing {
  const o = tracer.opts;
  const name = `${t.method} ${t.url.host}${routeOf(t.url.pathname)}`;
  const handle = o.captureOutbound
    ? tracer.beginCall(ctx.trace, ctx.spanId, { name, method: name, kind: 'http', params: ['request'] })
    : undefined;
  const span = spanOf(handle);
  const url = redactUrl(t.url);
  const propagate = o.propagate && !alreadyHasTraceparent && tracer.propagatesTo(t.url.hostname, t.url.host);
  let inject: Record<string, string> | undefined;
  if (propagate) {
    inject = { traceparent: formatTraceparent(ctx.trace.record.id, span?.id ?? ctx.spanId) };
    const state = formatTracestate(o.application);
    if (state) inject.tracestate = state;
  }
  if (span) {
    span.async = true;
    span.outbound ??= { method: t.method, url, host: t.url.host, propagated: !!inject };
  }
  return { ctx, handle, method: t.method, url, inject, done: false };
}

/** The span that stands for this call: its own, or the aggregate it is folded into. */
function spanOf(handle: CallHandle | undefined): SpanRecord | undefined {
  return handle?.mode === 'span' ? handle.span : handle?.mode === 'collapsed' ? handle.aggregate : undefined;
}

interface Outcome {
  request: { method: string; url: string; headers?: unknown; body?: unknown };
  statusCode?: number;
  headers?: Record<string, unknown>;
  body?: unknown;
  error?: unknown;
}

function finish(call: Outgoing, out: Outcome): void {
  if (call.done) return;
  call.done = true;
  const { ctx, handle } = call;
  const trace = ctx.trace;
  if (!handle || handle.mode === 'dropped' || trace.finished) return;
  const childTraceId = headerValue(out.headers?.[TRACE_ID_HEADER]);
  if (handle.mode === 'collapsed') {
    const failed = out.error ?? (out.statusCode !== undefined && out.statusCode >= 500 ? httpError(call, out.statusCode) : undefined);
    tracer.endCollapsed(trace, handle, [out.request], true, failed);
    return;
  }
  const span = handle.span;
  const ob = span.outbound!;
  if (out.statusCode !== undefined) ob.statusCode = out.statusCode;
  if (childTraceId) ob.childTraceId = childTraceId;
  tracer.captureArgs(trace, span, [out.request]);
  if (out.error !== undefined) return tracer.endSpan(trace, span, undefined, out.error);
  const result: Record<string, unknown> = { statusCode: out.statusCode, headers: out.headers };
  if (out.body !== undefined) result.body = out.body;
  tracer.endSpan(trace, span, result);
  // a 5xx from the callee is a failure of this call even though nothing threw
  if (out.statusCode !== undefined && out.statusCode >= 500) {
    span.status = 'error';
    span.error = { name: 'HttpError', message: `${call.method} ${call.url} responded ${out.statusCode}`, status: out.statusCode };
  }
}

function httpError(call: Outgoing, status: number) {
  return Object.assign(new Error(`${call.method} ${call.url} responded ${status}`), { name: 'HttpError', status });
}

function headerValue(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : undefined;
}

/** Bounded collector for body chunks. */
class BodyBuffer {
  private chunks: Buffer[] = [];
  size = 0;
  overflow = false;
  add(chunk: unknown, encoding?: unknown): void {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
    let buf: Buffer;
    if (typeof chunk === 'string') buf = Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
    else if (chunk instanceof Uint8Array) buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    else return;
    this.size += buf.length;
    if (this.overflow) return;
    const room = MAX_BODY_BYTES - (this.size - buf.length);
    if (buf.length > room) {
      this.overflow = true;
      buf = buf.subarray(0, Math.max(0, room));
    }
    this.chunks.push(Buffer.from(buf)); // copy: the caller may reuse its buffer
  }
  value(contentType: unknown, contentEncoding: unknown): unknown {
    if (!this.size) return undefined;
    const type = headerValue(contentType);
    if (type && !TEXTUAL.test(type)) return `[${type.split(';')[0]} body, ${this.size} bytes]`;
    let buf: Buffer = Buffer.concat(this.chunks);
    const enc = headerValue(contentEncoding)?.toLowerCase();
    if (enc && enc !== 'identity') {
      // the bytes on the wire are compressed: inflate (bounded) what we have, if we have all of it
      const inflated = this.overflow ? undefined : inflate(buf, enc);
      if (!inflated) return `[${enc} body, ${this.size} bytes]`;
      buf = inflated.buf;
      if (inflated.truncated) return `${buf.toString('utf8')}… [${enc}, ${this.size} bytes compressed]`;
    }
    return decodeText(buf.toString('utf8'), type, this.overflow, this.size);
  }
}

function inflate(buf: Buffer, enc: string): { buf: Buffer; truncated: boolean } | undefined {
  const opts = { maxOutputLength: MAX_BODY_BYTES * 4, finishFlush: zlib.constants.Z_SYNC_FLUSH };
  try {
    const out =
      enc === 'gzip' || enc === 'x-gzip'
        ? zlib.gunzipSync(buf, opts)
        : enc === 'deflate'
          ? zlib.inflateSync(buf, opts)
          : enc === 'br'
            ? zlib.brotliDecompressSync(buf, { maxOutputLength: MAX_BODY_BYTES * 4 })
            : undefined;
    if (!out) return undefined;
    return out.length > MAX_BODY_BYTES ? { buf: out.subarray(0, MAX_BODY_BYTES), truncated: true } : { buf: out, truncated: false };
  } catch {
    return undefined; // corrupt, or larger than maxOutputLength
  }
}

function decodeText(text: string, type: string | undefined, truncated: boolean, size: number): unknown {
  if (truncated) return `${text}… [${size} bytes]`;
  if (!type || /json/i.test(type)) {
    try {
      return JSON.parse(text);
    } catch {
      /* not JSON */
    }
  }
  return text;
}

function guard(what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    if (tracer.opts.debug) originalConsole.warn(`[stacklens] outgoing-call instrumentation failed (${what}):`, (e as Error)?.message);
  }
}

/* ------------------------------------------------------------------ */
/* node:http / node:https                                              */
/* ------------------------------------------------------------------ */

/** Work out method and URL from `request(url[, options][, cb])` / `request(options[, cb])`. */
function targetOf(args: unknown[], defaultProtocol: string): Target & { headers?: unknown } {
  let url: URL | undefined;
  let i = 0;
  if (typeof args[0] === 'string') {
    url = new URL(args[0]);
    i = 1;
  } else if (args[0] instanceof URL) {
    url = new URL(args[0].href);
    i = 1;
  }
  const opts = (args[i] && typeof args[i] === 'object' ? args[i] : {}) as Record<string, any>;
  if (!url || opts.hostname || opts.host || opts.path) {
    const protocol = opts.protocol ?? url?.protocol ?? defaultProtocol;
    let hostname = String(opts.hostname ?? opts.host ?? url?.hostname ?? 'localhost');
    if (!opts.hostname && opts.host && !hostname.startsWith('[')) hostname = hostname.replace(/:\d+$/, '');
    if (hostname.includes(':') && !hostname.startsWith('[')) hostname = `[${hostname}]`;
    const port = opts.port ?? (opts.hostname || opts.host ? undefined : url?.port);
    const path = opts.path ?? (url ? url.pathname + url.search : '/');
    url = new URL(`${protocol}//${hostname}${port ? `:${port}` : ''}${path}`);
  }
  return { method: String(opts.method ?? 'GET').toUpperCase(), url, headers: opts.headers };
}

function hasHeader(headers: unknown, name: string): boolean {
  if (!headers || typeof headers !== 'object') return false;
  if (Array.isArray(headers)) return headers.some((h, i) => i % 2 === 0 && String(h).toLowerCase() === name);
  return Object.keys(headers).some((k) => k.toLowerCase() === name);
}

function wrapRequest(orig: (...args: any[]) => http.ClientRequest, defaultProtocol: string) {
  return function stacklensRequest(this: unknown, ...args: any[]): http.ClientRequest {
    const ctx = currentContext();
    if (!ctx) return orig.apply(this, args);
    let call: Outgoing | undefined;
    guard('request', () => {
      const t = targetOf(args, defaultProtocol);
      if (!isCollector(t.url)) call = begin(ctx, t, hasHeader(t.headers, 'traceparent'));
    });
    if (!call) return orig.apply(this, args);
    let req: http.ClientRequest;
    try {
      req = orig.apply(this, args);
    } catch (e) {
      finish(call, { request: { method: call.method, url: call.url }, error: e });
      throw e;
    }
    const c = call;
    guard('observe', () => observeClientRequest(req, c));
    return req;
  };
}

function observeClientRequest(req: http.ClientRequest, call: Outgoing): void {
  if (call.inject) {
    try {
      if (req.headersSent || req.getHeader('traceparent') !== undefined) throw new Error('headers already set');
      for (const [k, v] of Object.entries(call.inject)) if (req.getHeader(k) === undefined) req.setHeader(k, v);
    } catch {
      // raw header arrays / headers already flushed: send the request untouched
      const span = spanOf(call.handle);
      if (span?.outbound && call.handle?.mode === 'span') span.outbound.propagated = false;
    }
  }

  const reqBody = new BodyBuffer();
  const { write, end, emit } = req;
  req.write = function (this: http.ClientRequest, chunk: any, ...rest: any[]) {
    guard('write', () => reqBody.add(chunk, typeof rest[0] === 'string' ? rest[0] : undefined));
    return (write as any).call(this, chunk, ...rest);
  } as typeof req.write;
  req.end = function (this: http.ClientRequest, chunk?: any, ...rest: any[]) {
    guard('end', () => reqBody.add(chunk, typeof rest[0] === 'string' ? rest[0] : undefined));
    return (end as any).call(this, chunk, ...rest);
  } as typeof req.end;

  const request = () => {
    let headers: unknown;
    try {
      headers = req.getHeaders();
    } catch {
      headers = undefined;
    }
    return {
      method: call.method,
      url: call.url,
      headers,
      body: reqBody.value(req.getHeader?.('content-type'), req.getHeader?.('content-encoding')),
    };
  };

  let response: http.IncomingMessage | undefined;
  // snapshot: clients edit res.headers afterwards (axios drops content-encoding once it inflates)
  let resHeaders: http.IncomingHttpHeaders | undefined;
  const resBody = new BodyBuffer();
  const done = (error?: unknown) =>
    finish(call, {
      request: request(),
      statusCode: response?.statusCode,
      headers: resHeaders,
      body: resHeaders ? resBody.value(resHeaders['content-type'], resHeaders['content-encoding']) : undefined,
      error,
    });

  // observe events by wrapping emit – adding a 'response' listener would stop Node from discarding unread bodies
  req.emit = function (this: http.ClientRequest, event: string | symbol, ...a: any[]) {
    guard('emit', () => {
      if (event === 'response') {
        response = a[0] as http.IncomingMessage;
        resHeaders = { ...response.headers };
        observeResponse(response, resBody, done);
      } else if (event === 'error') done(a[0]);
      else if (event === 'close' && !response) done(new Error('socket closed before a response arrived'));
    });
    return (emit as any).call(this, event, ...a);
  } as typeof req.emit;
}

function observeResponse(res: http.IncomingMessage, body: BodyBuffer, done: (error?: unknown) => void): void {
  const { push, emit } = res;
  // the HTTP parser feeds the body through push(), whatever way the caller consumes it (or not at all)
  res.push = function (this: http.IncomingMessage, chunk: any, encoding?: BufferEncoding) {
    guard('push', () => (chunk === null ? done() : body.add(chunk, encoding)));
    return push.call(this, chunk, encoding);
  };
  res.emit = function (this: http.IncomingMessage, event: string | symbol, ...a: any[]) {
    guard('response emit', () => {
      if (event === 'error' || event === 'aborted') done(a[0] ?? new Error('response aborted'));
      else if (event === 'close') done();
    });
    return (emit as any).call(this, event, ...a);
  } as typeof res.emit;
}

/* ------------------------------------------------------------------ */
/* global fetch                                                        */
/* ------------------------------------------------------------------ */

function fetchTarget(input: unknown, init: RequestInit | undefined): Target {
  const isReq = typeof Request !== 'undefined' && input instanceof Request;
  const href = isReq ? (input as Request).url : input instanceof URL ? input.href : String(input);
  const method = (init?.method ?? (isReq ? (input as Request).method : 'GET')).toUpperCase();
  return { method, url: new URL(href) };
}

function fetchBody(body: unknown, headers: Headers): unknown {
  if (body === undefined || body === null) return undefined;
  const type = headers.get('content-type') ?? undefined;
  if (typeof body === 'string') return decodeText(body.slice(0, MAX_BODY_BYTES), type, body.length > MAX_BODY_BYTES, body.length);
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    const b = new BodyBuffer();
    b.add(body instanceof ArrayBuffer ? new Uint8Array(body) : body);
    return b.value(type ?? 'application/octet-stream', headers.get('content-encoding'));
  }
  // streams, Blobs and FormData are sent as they are; reading them here would consume them
  return `[${(body as object).constructor?.name ?? 'stream'} body]`;
}

export function wrapFetch(orig: typeof fetch): typeof fetch {
  return function stacklensFetch(this: unknown, input: any, init?: RequestInit) {
    const ctx = currentContext();
    if (!ctx) return orig.call(this, input, init);
    let call: Outgoing | undefined;
    let headers: Headers | undefined;
    let request: Outcome['request'] | undefined;
    guard('fetch', () => {
      const t = fetchTarget(input, init);
      if (isCollector(t.url)) return;
      const base = init?.headers ?? (input instanceof Request ? input.headers : undefined);
      headers = new Headers(base as ConstructorParameters<typeof Headers>[0]);
      call = begin(ctx, t, headers.has('traceparent'));
      for (const [k, v] of Object.entries(call.inject ?? {})) if (!headers.has(k)) headers.set(k, v);
      request = { method: t.method, url: call.url, headers: Object.fromEntries(headers), body: fetchBody(init?.body, headers) };
    });
    if (!call || !request) return orig.call(this, input, init);
    const c = call;
    const req = request;
    const span = spanOf(c.handle);
    // run inside the outgoing span: a fetch polyfill built on node:http must not record the call again
    const run = () => orig.call(this, input, call!.inject ? { ...init, headers } : init);
    let pending: Promise<Response>;
    try {
      pending = span && c.handle?.mode === 'span' ? traceContext.run({ trace: ctx.trace, spanId: span.id }, run) : run();
    } catch (e) {
      finish(c, { request: req, error: e });
      throw e;
    }
    return pending.then(
      (res) => {
        guard('fetch response', () => {
          finish(c, { request: req, statusCode: res.status, headers: Object.fromEntries(res.headers) });
          if (c.handle?.mode === 'span') captureFetchBody(res, c, c.handle.span);
        });
        return res;
      },
      (e) => {
        finish(c, { request: req, error: e });
        throw e;
      },
    );
  } as typeof fetch;
}

/**
 * Attach the response body once the caller reads it – with `json()`, `text()`, `arrayBuffer()`,
 * `bytes()`, `blob()` or by streaming `res.body` – and extend the span to the moment it was read.
 * We never read, tee or buffer the body ourselves: a body the app doesn't read isn't captured,
 * and one it streams is copied chunk by chunk (up to the body limit) as the app pulls it.
 */
function captureFetchBody(res: Response, call: Outgoing, span: SpanRecord): void {
  const trace = call.ctx.trace;
  const type = res.headers.get('content-type') ?? undefined;
  let attached = false;
  const attach = (value: () => unknown) =>
    guard('fetch body', () => {
      if (attached || trace.finished) return;
      attached = true;
      const v = value();
      const captured = v === undefined ? undefined : tracer.captureLate(trace, span, v);
      if (captured !== undefined && span.result && typeof span.result === 'object')
        (span.result as Record<string, unknown>).body = captured;
      span.duration = Math.max(span.duration, performance.now() - trace.t0 - span.start);
    });
  // fetch has already inflated the body, so content-encoding no longer applies to what the app reads
  const fromBytes = (bytes: Uint8Array) => {
    const b = new BodyBuffer();
    b.add(bytes);
    return b.value(type, undefined);
  };
  const readers: Record<string, (v: any) => unknown> = {
    json: (v) => v,
    text: (v) => decodeText(String(v), type, false, 0),
    arrayBuffer: (v: ArrayBuffer) => fromBytes(new Uint8Array(v)),
    bytes: (v: Uint8Array) => fromBytes(v),
    blob: (v: Blob) => `[${v.type || 'binary'} body, ${v.size} bytes]`,
    formData: () => '[form data body]',
  };
  for (const [method, toValue] of Object.entries(readers)) {
    const orig = (res as any)[method];
    if (typeof orig !== 'function') continue;
    Object.defineProperty(res, method, {
      configurable: true,
      writable: true,
      value: function (this: Response, ...args: unknown[]) {
        const p = orig.apply(this, args) as Promise<unknown>;
        p.then(
          (v) => attach(() => toValue(v)),
          () => {},
        );
        return p;
      },
    });
  }
  // res.body: hand out a stream that pulls from the real one only when the app reads it, so merely
  // touching `res.body` (or never reading it) leaves the response exactly as it was
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(res), 'body');
  if (!desc?.get) return;
  let wrapped: ReadableStream<Uint8Array> | null | undefined;
  Object.defineProperty(res, 'body', {
    configurable: true,
    get(this: Response) {
      if (wrapped !== undefined) return wrapped;
      const source = desc.get!.call(this) as ReadableStream<Uint8Array> | null;
      if (!source) return (wrapped = source);
      const buf = new BodyBuffer();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      wrapped = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            reader ??= source.getReader();
            try {
              const { done, value } = await reader.read();
              if (done) {
                attach(() => buf.value(type, undefined));
                controller.close();
                return;
              }
              guard('fetch stream', () => buf.add(value));
              controller.enqueue(value);
            } catch (e) {
              controller.error(e);
            }
          },
          cancel(reason) {
            attach(() => buf.value(type, undefined));
            return reader ? reader.cancel(reason) : source.cancel(reason);
          },
        },
        { highWaterMark: 0 },
      );
      return wrapped;
    },
  });
}

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

let installed = false;

/**
 * Patch `http`, `https` and the global `fetch`. Idempotent; called by `stacklens.init()`.
 * Code that grabbed a reference to `http.request` / `fetch` before this ran is not covered.
 */
export function instrumentHttpClient(): void {
  if (installed) return;
  installed = true;
  for (const [mod, protocol] of [
    [http, 'http:'],
    [https, 'https:'],
  ] as const) {
    const m = mod as any;
    if (m.request?.[kPatched]) continue;
    const request = wrapRequest(m.request, protocol);
    // Node's get() calls the module-internal request(); re-implement it on top of the patched one
    const get = function (this: unknown, ...args: any[]) {
      const req = request.apply(this, args);
      req.end();
      return req;
    };
    for (const [name, fn] of [
      ['request', request],
      ['get', get],
    ] as const) {
      Object.defineProperty(fn, kPatched, { value: true });
      m[name] = fn;
    }
  }
  try {
    syncBuiltinESMExports(); // `import { request } from 'node:http'` sees the patched functions
  } catch {
    /* older runtimes */
  }
  if (typeof globalThis.fetch === 'function' && !(globalThis.fetch as any)[kPatched]) {
    const f = wrapFetch(globalThis.fetch);
    Object.defineProperty(f, kPatched, { value: true });
    globalThis.fetch = f;
  }
}

/** Headers to send with a request made by other means (queues, gRPC, a custom client), or `{}` outside a trace. */
export function propagationHeaders(): Record<string, string> {
  const ctx = traceContext.getStore();
  if (!ctx || !tracer.opts.enabled || !tracer.opts.propagate) return {};
  const out: Record<string, string> = { traceparent: formatTraceparent(ctx.trace.record.id, ctx.spanId) };
  const state = formatTracestate(tracer.opts.application);
  if (state) out.tracestate = state;
  return out;
}
