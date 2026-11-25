import { AsyncResource } from 'node:async_hooks';
import type { EventEmitter } from 'node:events';
import { traceContext } from '../core/context';
import { tracer } from '../core/tracer';

type Req = any;
type Res = any;
type Next = (err?: unknown) => void;

const ADD = ['on', 'addListener', 'once', 'prependListener', 'prependOnceListener'] as const;
const REMOVE = ['off', 'removeListener'] as const;

/**
 * Bind listeners attached to req/res to the current async context.
 * Body parsers read the request stream via events that are emitted from the
 * HTTP parser's context – without this, ALS context would be lost after `express.json()`.
 */
function bindEmitter(ee: EventEmitter) {
  const map = new WeakMap<Function, Function>();
  for (const m of ADD) {
    const orig = (ee as any)[m];
    if (typeof orig !== 'function') continue;
    (ee as any)[m] = function (this: any, event: string | symbol, listener: Function) {
      if (typeof listener === 'function' && traceContext.getStore()) {
        let bound: Function | undefined = map.get(listener);
        if (!bound) {
          bound = AsyncResource.bind(listener as any);
          (bound as any).listener = listener; // lets removeListener(original) match natively
          map.set(listener, bound!);
        }
        return orig.call(this, event, bound);
      }
      return orig.call(this, event, listener);
    };
  }
  for (const m of REMOVE) {
    const orig = (ee as any)[m];
    if (typeof orig !== 'function') continue;
    (ee as any)[m] = function (this: any, event: string | symbol, listener: Function) {
      return orig.call(this, event, map.get(listener) ?? listener);
    };
  }
}

/** Rebuild the full route pattern (baseUrl may already be reset when error handlers run). */
function routeFromReq(req: Req, path: string): string | undefined {
  const rp = req.route?.path;
  if (typeof rp !== 'string') return undefined;
  const routeSegs = rp.split('/').filter(Boolean);
  const pathSegs = path.split('/').filter(Boolean);
  const base = pathSegs.slice(0, Math.max(0, pathSegs.length - routeSegs.length));
  return '/' + [...base, ...routeSegs].join('/');
}

export interface ExpressMiddlewareOptions {
  /** Capture request body / query / params / headers. Default true */
  captureRequest?: boolean;
  /** Capture response body (res.json / res.send). Default true */
  captureResponse?: boolean;
  /** Request headers to keep (lower-case). Default: all (sensitive ones are redacted) */
  headers?: string[];
}

/**
 * Express / NestJS(express) entry-point middleware.
 * Creates one trace per request; every instrumented call made while handling the
 * request becomes part of its call tree.
 */
export function expressMiddleware(options: ExpressMiddlewareOptions = {}) {
  const captureRequest = options.captureRequest ?? true;
  const captureResponse = options.captureResponse ?? true;

  return function stacklensMiddleware(req: Req, res: Res, next: Next) {
    const path: string = (req.originalUrl ?? req.url ?? '/').split('?')[0];
    if (!tracer.shouldSample() || tracer.isIgnoredPath(path)) return next();

    const method: string = req.method ?? 'GET';
    const { trace, root } = tracer.createTrace(`${method} ${path}`, 'http', 'http');
    trace.record.http = { method, url: req.originalUrl ?? req.url, ip: req.ip ?? req.socket?.remoteAddress };
    req.stacklensTraceId = trace.record.id;
    try {
      res.setHeader?.('x-stacklens-trace-id', trace.record.id);
    } catch {
      /* headers already sent */
    }

    let responseBody: unknown;
    if (captureResponse) {
      const origJson = res.json;
      const origSend = res.send;
      let inJson = false;
      if (typeof origJson === 'function') {
        res.json = function (this: unknown, ...args: unknown[]) {
          responseBody = args[0];
          inJson = true;
          try {
            return origJson.apply(this, args);
          } finally {
            inJson = false;
          }
        };
      }
      if (typeof origSend === 'function') {
        res.send = function (this: unknown, ...args: unknown[]) {
          const body = args[0];
          if (!inJson && responseBody === undefined) {
            if (typeof body === 'string') {
              try {
                responseBody = JSON.parse(body);
              } catch {
                responseBody = body;
              }
            } else responseBody = Buffer.isBuffer(body) ? `<Buffer ${body.length} bytes>` : body;
          }
          return origSend.apply(this, args);
        };
      }
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const http = trace.record.http!;
      http.statusCode = res.statusCode;
      const route = routeFromReq(req, path);
      if (route) {
        http.route = route;
        trace.record.name = `${method} ${route}`;
        root.name = trace.record.name;
        root.method = trace.record.name;
      }
      if (captureRequest) {
        let headers = req.headers;
        if (options.headers && headers) {
          headers = Object.fromEntries(Object.entries(headers).filter(([k]) => options.headers!.includes(k)));
        }
        http.request = {
          headers: tracer.serialize(headers),
          query: tracer.serialize(req.query),
          params: tracer.serialize(req.params),
          body: req.body === undefined ? undefined : tracer.serialize(req.body),
        };
      }
      if (captureResponse) {
        http.response = {
          headers: tracer.serialize(typeof res.getHeaders === 'function' ? res.getHeaders() : undefined),
          body: responseBody === undefined ? undefined : tracer.serialize(responseBody),
        };
      }
      if (!trace.record.userId) {
        try {
          const uid = tracer.opts.getUserId(req);
          if (uid !== undefined && uid !== null && uid !== '') trace.record.userId = String(uid);
        } catch {
          /* resolver threw */
        }
      }
      root.attributes = { statusCode: res.statusCode };
      const err = res.statusCode >= 500 ? new Error(`HTTP ${res.statusCode}`) : undefined;
      tracer.finishTrace(trace, root, err);
    };
    res.once('finish', finish);
    res.once('close', finish);

    traceContext.run({ trace, spanId: root.id }, () => {
      bindEmitter(req);
      bindEmitter(res);
      next();
    });
  };
}
