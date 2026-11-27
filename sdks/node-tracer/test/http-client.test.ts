import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stacklens, type TraceRecord } from '../src';
import { tracer } from '../src/core/tracer';
import { formatTraceparent, formatTracestate, hostMatcher, parseTraceparent, parseTracestate } from '../src/core/propagation';
import { redactUrl, routeOf, wrapFetch } from '../src/integrations/http-client';

const exported: TraceRecord[] = [];
/** Resolves once a trace matching `pred` has been exported. */
const waitFor = (pred: (t: TraceRecord) => boolean) =>
  new Promise<TraceRecord>((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const iv = setInterval(() => {
      const t = exported.find(pred);
      if (t) {
        clearInterval(iv);
        resolve(t);
      } else if (Date.now() > deadline) {
        clearInterval(iv);
        reject(new Error(`no matching trace among ${exported.map((x) => x.name).join(', ')}`));
      }
    }, 5);
  });
const outbound = (t: TraceRecord) => t.spans.filter((s) => s.outbound);

/** Headers the child server saw on its last request. */
let seen: http.IncomingHttpHeaders[] = [];
let child = '';
let parent = '';
const servers: http.Server[] = [];

async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  stacklens.init({ application: 'orders-api', exporter: (t) => exported.push(t), settleMs: 0, captureConsole: false, debug: false });

  const c = express();
  c.use((req, _res, next) => {
    seen.push({ ...req.headers });
    next();
  });
  c.use(stacklens.express());
  c.use(express.json());
  c.get('/orders/:id', (req, res) => res.json({ id: Number(req.params.id), total: 42, secret: 's3' }));
  c.post('/orders', (req, res) => res.status(201).json({ created: req.body }));
  c.get('/boom', (_req, res) => res.status(503).json({ error: 'down' }));
  child = await listen(c);

  const p = express();
  p.use(stacklens.express());
  p.get('/fetch', async (_req, res) => {
    const r = await fetch(`${child}/orders/7?token=abc&q=1`, { headers: { authorization: 'Bearer xyz' } });
    res.json({ upstream: await r.json() });
  });
  p.get('/http-get', (_req, res) => {
    http.get(`${child}/orders/8`, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (d) => (body += d));
      r.on('end', () => res.json({ upstream: JSON.parse(body) }));
    });
  });
  // what axios' node adapter does: http.request(options) + write(body) + end()
  p.get('/axios-style', (_req, res) => {
    const u = new URL(child);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: '/orders', method: 'POST', headers: { 'content-type': 'application/json' } },
      (r) => {
        r.resume();
        r.on('end', () => res.json({ status: r.statusCode }));
      },
    );
    req.write(JSON.stringify({ sku: 'kb-01', password: 'hunter2' }));
    req.end();
  });
  p.get('/unread', (_req, res) => {
    // no response listener at all: Node must still discard the body and free the socket
    http.get(`${child}/orders/9`);
    setTimeout(() => res.json({ ok: true }), 30);
  });
  p.get('/boom', async (_req, res) => {
    const r = await fetch(`${child}/boom`);
    res.json({ status: r.status });
  });
  p.get('/refused', async (_req, res) => {
    try {
      await fetch('http://127.0.0.1:1/nothing');
      res.json({ ok: true });
    } catch (e) {
      res.json({ error: (e as Error).message });
    }
  });
  p.get('/loop', async (_req, res) => {
    for (let i = 0; i < 15; i++) await (await fetch(`${child}/orders/${i}`)).text();
    res.json({ ok: true });
  });
  parent = await listen(p);
});

afterAll(() => servers.forEach((s) => s.close()));
beforeEach(() => {
  exported.length = 0;
  seen = [];
  tracer.configure({ propagate: true, propagateTo: undefined, captureOutbound: true });
});

/** Request the parent app (from outside any trace) and return the parent trace and the child traces linked to it. */
async function call(path: string) {
  const res = await fetch(parent + path);
  const id = res.headers.get('x-stacklens-trace-id')!;
  await res.text();
  const p = await waitFor((t) => t.id === id);
  return { trace: p, children: () => exported.filter((t) => t.parent?.traceId === id) };
}

describe('W3C trace context', () => {
  it('formats and parses traceparent', () => {
    const tp = formatTraceparent('4bf92f3577b34da6a3ce929d0e0e4736', '00f067aa0ba902b7');
    expect(tp).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(parseTraceparent(tp)).toEqual({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' });
    expect(parseTraceparent(tp.toUpperCase())).toBeDefined();
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeUndefined();
    expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeUndefined();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra')).toBeUndefined();
    expect(parseTraceparent('garbage')).toBeUndefined();
    expect(parseTraceparent(undefined)).toBeUndefined();
    // ids that aren't W3C-shaped are padded / hashed into shape
    expect(formatTraceparent('abc', '1')).toMatch(/^00-0{29}abc-0{15}1-01$/);
    expect(formatTraceparent('order-run-7', 'span:x')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('carries the application name in tracestate', () => {
    expect(formatTracestate('orders api, v2=x')).toBe('stacklens=orders api_ v2_x');
    expect(parseTracestate('congo=t61rcWkgMzE,stacklens=orders-api')).toBe('orders-api');
    expect(parseTracestate(['a=1', 'stacklens=x'])).toBe('x');
    expect(parseTracestate('congo=1')).toBeUndefined();
  });

  it('matches propagateTo entries by host, subdomain suffix and RegExp', () => {
    const m = hostMatcher(['billing.internal', '.svc.local', /^127\.0\.0\.1:\d+$/]);
    expect(m('billing.internal', 'billing.internal')).toBe(true);
    expect(m('orders.svc.local', 'orders.svc.local:8080')).toBe(true);
    expect(m('127.0.0.1', '127.0.0.1:3002')).toBe(true);
    expect(m('api.stripe.com', 'api.stripe.com')).toBe(false);
    expect(hostMatcher(undefined)('anything', 'anything')).toBe(true);
  });

  it('groups ids in span names and redacts secrets in URLs', () => {
    expect(routeOf('/orders/42/items/9f86d081884c7d65')).toBe('/orders/:id/items/:id');
    expect(routeOf('/users/550e8400-e29b-41d4-a716-446655440000/profile')).toBe('/users/:id/profile');
    expect(routeOf('/v2/orders')).toBe('/v2/orders');
    expect(redactUrl(new URL('https://u:p@api.x.com/a?token=abc&q=1#h'))).toBe('https://api.x.com/a?token=[REDACTED]&q=1');
  });
});

describe('outgoing calls', () => {
  it('fetch: records a span, propagates traceparent and links the child trace', async () => {
    const { trace, children } = await call('/fetch');
    const spans = outbound(trace);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    const host = new URL(child).host;
    expect(span).toMatchObject({ kind: 'http', name: `GET ${host}/orders/:id`, status: 'ok', parentId: trace.spans[0].id });
    expect(span.outbound).toMatchObject({ method: 'GET', host, statusCode: 200, propagated: true });
    expect(span.outbound!.url).toBe(`${child}/orders/7?token=[REDACTED]&q=1`);

    // the child saw our ids and recorded us as its parent
    expect(seen[0].traceparent).toBe(formatTraceparent(trace.id, span.id));
    expect(seen[0].tracestate).toBe('stacklens=orders-api');
    const [c] = children();
    expect(c.parent).toEqual({ traceId: trace.id, spanId: span.id, service: 'orders-api' });
    expect(span.outbound!.childTraceId).toBe(c.id);

    // request / response captured with the usual redaction
    const req = span.args![0] as { headers: Record<string, string> };
    expect(req.headers.authorization).toBe('[REDACTED]');
    expect(req.headers.traceparent).toBe(seen[0].traceparent);
    expect(span.result).toMatchObject({ statusCode: 200, body: { id: 7, total: 42, secret: '[REDACTED]' } });
  });

  it('http.get: records the call once, with the response body read through events', async () => {
    const { trace, children } = await call('/http-get');
    const [span] = outbound(trace);
    expect(outbound(trace)).toHaveLength(1);
    expect(span.outbound).toMatchObject({ method: 'GET', statusCode: 200, propagated: true });
    expect(span.result).toMatchObject({ body: { id: 8 } });
    expect(children()[0].parent?.spanId).toBe(span.id);
    expect(span.outbound!.childTraceId).toBe(children()[0].id);
  });

  it('http.request with options, write() and end() (axios node adapter)', async () => {
    const { trace, children } = await call('/axios-style');
    const [span] = outbound(trace);
    expect(span.name).toBe(`POST ${new URL(child).host}/orders`);
    expect(span.args![0]).toMatchObject({ method: 'POST', body: { sku: 'kb-01', password: '[REDACTED]' } });
    expect(span.result).toMatchObject({ statusCode: 201, body: { created: { sku: 'kb-01', password: '[REDACTED]' } } });
    expect(children()[0].http?.request?.body).toMatchObject({ sku: 'kb-01' });
  });

  it('does not keep unread responses alive', async () => {
    const { trace } = await call('/unread');
    const [span] = outbound(trace);
    expect(span.outbound?.statusCode).toBe(200);
    expect(span.status).toBe('ok');
  });

  it('marks 5xx responses and connection errors as failed calls without changing what the app sees', async () => {
    const boom = await call('/boom');
    expect(boom.trace.http?.response?.body).toEqual({ status: 503 });
    expect(outbound(boom.trace)[0]).toMatchObject({ status: 'error', error: { name: 'HttpError', status: 503 } });

    const refused = await call('/refused');
    expect(refused.trace.http?.response?.body).toMatchObject({ error: 'fetch failed' });
    expect(outbound(refused.trace)[0]).toMatchObject({ status: 'error', outbound: { host: '127.0.0.1:1' } });
  });

  it('collapses outgoing calls made in a loop', async () => {
    const { trace, children } = await call('/loop');
    const spans = outbound(trace);
    expect(spans.length).toBe(11); // 10 individual + 1 aggregate
    expect(spans.find((s) => s.collapsed)?.collapsed?.count).toBe(5);
    // folded calls still propagate (to the aggregate span), so every child links back
    await waitFor(() => children().length === 15);
    expect(new Set(children().map((c) => c.parent!.spanId))).toEqual(new Set(spans.map((s) => s.id)));
  });

  it('respects propagateTo and propagate: false', async () => {
    tracer.configure({ propagateTo: ['billing.internal'] });
    const a = await call('/fetch');
    expect(seen[0].traceparent).toBeUndefined();
    expect(outbound(a.trace)[0].outbound).toMatchObject({ propagated: false, statusCode: 200 });
    expect(a.children()).toHaveLength(0);

    seen = [];
    tracer.configure({ propagateTo: undefined, propagate: false });
    await call('/http-get');
    expect(seen[0].traceparent).toBeUndefined();
  });

  it('captureOutbound: false still propagates, linking the child to the calling span', async () => {
    tracer.configure({ captureOutbound: false });
    const { trace, children } = await call('/fetch');
    expect(outbound(trace)).toHaveLength(0);
    expect(children()[0].parent?.spanId).toBe(trace.spans[0].id);
  });

  it('adds nothing outside a trace', async () => {
    await fetch(`${child}/orders/1`).then((r) => r.text());
    await new Promise<void>((r) => http.get(`${child}/orders/1`, (res) => res.resume().on('end', r)));
    expect(seen.map((h) => h.traceparent)).toEqual([undefined, undefined]);
  });

  it('keeps a traceparent the caller already set', async () => {
    const theirs = '00-11111111111111111111111111111111-2222222222222222-01';
    await stacklens.trace('job', () => fetch(`${child}/orders/1`, { headers: { traceparent: theirs } }).then((r) => r.text()));
    expect(seen[0].traceparent).toBe(theirs);
  });

  it('a fetch built on node:http is recorded once (no double span)', async () => {
    // a polyfill in the style of node-fetch: fetch() implemented with http.get
    const polyfill = ((url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const headers = Object.fromEntries(new Headers(init?.headers));
        http
          .get(url, { headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d) => chunks.push(d));
            res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })));
          })
          .on('error', reject);
      })) as unknown as typeof fetch;
    const f = wrapFetch(polyfill);
    let job: TraceRecord | undefined;
    const pending = waitFor((t) => t.name === 'polyfill-job').then((t) => (job = t));
    await stacklens.trace('polyfill-job', () => f(`${child}/orders/3`).then((r) => r.json()));
    await pending;
    const spans = outbound(job!);
    expect(spans).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].traceparent).toBe(formatTraceparent(job!.id, spans[0].id));
    expect((spans[0].result as { body: unknown }).body).toMatchObject({ id: 3 });
  });

  it('exposes propagationHeaders() for other transports', async () => {
    expect(stacklens.propagationHeaders()).toEqual({});
    let headers: Record<string, string> = {};
    let traceId = '';
    await stacklens.trace('queue-publish', () => {
      headers = stacklens.propagationHeaders();
      traceId = stacklens.currentTraceId()!;
    });
    expect(parseTraceparent(headers.traceparent)?.traceId).toBe(traceId);
  });
});
