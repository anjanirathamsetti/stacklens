/**
 * @stacklens/tracer — drop-in call-tree tracing for Node.js backends.
 *
 * ```ts
 * import { stacklens } from '@stacklens/tracer';
 * stacklens.init({ application: 'orders-api', project: 'storefront' });
 * app.use(stacklens.express());
 * ```
 *
 * @packageDocumentation
 */
import { patchConsole } from './core/console';
import { traceContext } from './core/context';
import { tracer } from './core/tracer';
import { autoInstrument, type AutoInstrumentOptions } from './instrumentation/auto-instrument';
import { instrument, instrumentClass, kindFromName, wrapFunction } from './instrumentation/wrap';
import { expressMiddleware, type ExpressMiddlewareOptions } from './integrations/express';
import { instrumentNest, type NestInstrumentOptions } from './integrations/nestjs';
import { instrumentTypeORM, type TypeOrmInstrumentOptions } from './integrations/typeorm';
import type { InstrumentOptions, SpanKind, StackLensOptions } from './types';

export * from './types';
export { Traced, instrument, instrumentClass, unwrap, wrapFunction } from './instrumentation/wrap';
export { autoInstrument } from './instrumentation/auto-instrument';
export { expressMiddleware } from './integrations/express';
export { instrumentNest } from './integrations/nestjs';
export { instrumentTypeORM } from './integrations/typeorm';
export type { AutoInstrumentOptions, ExpressMiddlewareOptions, NestInstrumentOptions, TypeOrmInstrumentOptions };

/** The StackLens SDK facade. */
export const stacklens = {
  /** Configure the tracer. Safe to call more than once; later calls override earlier ones. */
  init(options: StackLensOptions = {}) {
    tracer.configure(options);
    if (tracer.opts.captureConsole) patchConsole((level, args) => tracer.opts.captureConsole && tracer.addLog(level, args));
    process.once('beforeExit', () => void tracer.flush());
    return stacklens;
  },

  /** Express (and NestJS-on-Express) entry-point middleware: one trace per request. */
  express: (options?: ExpressMiddlewareOptions) => expressMiddleware(options),

  /** NestJS: instrument every controller, provider and repository and register the middleware. Call before `app.listen()`. */
  instrumentNest: (app: unknown, options?: NestInstrumentOptions) => instrumentNest(app, options),

  /** TypeORM: trace Repository, EntityManager, QueryBuilder and raw SQL. Pass `require('typeorm')` / `import * as typeorm`. */
  instrumentTypeORM: (typeorm: unknown, options?: TypeOrmInstrumentOptions) => instrumentTypeORM(typeorm, options),

  /** CommonJS apps: wrap everything exported from matching files via a `require` hook. Call before loading app code. */
  autoInstrument: (options?: AutoInstrumentOptions) => autoInstrument(options),

  /** Instrument an object, class instance or module exports. */
  instrument: <T extends object>(target: T, options?: InstrumentOptions) => instrument(target, options),

  /** Instrument a class (patches its prototype chain, so every instance is traced). */
  instrumentClass: <T extends Function>(cls: T, options?: InstrumentOptions) => instrumentClass(cls, options),

  /** Wrap a single function. `name` may be `"Class.method"`. */
  wrap<T extends Function>(fn: T, name?: string, kind?: SpanKind): T {
    const [className, method] = name?.includes('.') ? name.split(/\.(?=[^.]+$)/) : [undefined, name];
    return wrapFunction(fn, { className, method, kind: kind ?? kindFromName(className) });
  },

  /**
   * Start a root trace outside HTTP (cron jobs, queue consumers, scripts).
   * Inside an existing trace it records a child span instead.
   */
  async trace<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    if (traceContext.getStore()) return wrapFunction(fn, { method: name, kind: 'job' })();
    if (!tracer.shouldSample()) return fn();
    const { trace, root } = tracer.createTrace(name, 'job', 'job');
    try {
      const out = await traceContext.run({ trace, spanId: root.id }, fn);
      tracer.finishTrace(trace, root);
      return out;
    } catch (e) {
      tracer.finishTrace(trace, root, e);
      throw e;
    }
  },

  /** Attach a log line (and optional data) to the currently executing call. */
  log(message: string, data?: unknown): void {
    tracer.addLog('info', data === undefined ? [message] : [message, data]);
  },

  /** Add custom attributes to the currently executing call. */
  setAttributes(attributes: Record<string, unknown>): void {
    const ctx = traceContext.getStore();
    const span = ctx?.trace.record.spans.find((s) => s.id === ctx.spanId);
    if (span) span.attributes = { ...(span.attributes ?? {}), ...(tracer.serialize(attributes) as object) };
  },

  /** Set the end-user id of the current trace (overrides `getUserId`). */
  setUser(userId: string | number): void {
    const ctx = traceContext.getStore();
    if (ctx) ctx.trace.record.userId = String(userId);
  },

  /** Id of the current trace, e.g. to include in error responses or logs. */
  currentTraceId(): string | undefined {
    return traceContext.getStore()?.trace.record.id;
  },

  /** Send queued traces now (call before exit in scripts and tests). */
  flush: (): Promise<void> => tracer.flush(),
};

export default stacklens;
