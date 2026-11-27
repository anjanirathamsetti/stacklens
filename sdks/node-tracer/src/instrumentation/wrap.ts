import { EventEmitter } from 'node:events';
import { traceContext } from '../core/context';
import { tracer } from '../core/tracer';
import { getParamNames } from '../serialization';
import type { InstrumentOptions, SpanKind } from '../types';

const WRAPPED = Symbol.for('stacklens.wrapped');
const ORIGINAL = Symbol.for('stacklens.original');
const PATCHED_PROTOS = new WeakSet<object>();

/** Prototypes we never walk into / patch (would trace the whole runtime). */
const STOP_PROTOS = new Set<object>([Object.prototype, Function.prototype, EventEmitter.prototype]);

const ALWAYS_SKIP = new Set([
  'constructor',
  'toString',
  'toJSON',
  'valueOf',
  'inspect',
  'then',
  'catch',
  'finally',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

export function isClass(fn: unknown): boolean {
  return typeof fn === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(fn));
}

export function isWrapped(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as any)[WRAPPED] === true;
}

/** Guess span kind from a class/file name. */
export function kindFromName(name: string | undefined, fallback: SpanKind = 'function'): SpanKind {
  if (!name) return fallback;
  if (/controller$/i.test(name) || /\.controller$/i.test(name)) return 'controller';
  if (/(handler|resolver|gateway|consumer|processor|listener)$/i.test(name)) return 'handler';
  if (/(repository|repo|dao|model)$/i.test(name)) return 'repository';
  if (/(service|manager|provider|facade|usecase|helper|client)$/i.test(name)) return 'service';
  return fallback;
}

export interface WrapMeta {
  /** Fixed label, or a resolver evaluated with `this` at call time */
  className?: string | ((self: any) => string | undefined);
  method?: string;
  kind?: SpanKind | ((self: any) => SpanKind);
}

function matches(list: (string | RegExp)[] | undefined, name: string) {
  return !!list?.some((p) => (typeof p === 'string' ? p === name : p.test(name)));
}

function copyMetadata(from: Function, to: Function) {
  // Preserve name / length so frameworks & stack traces look normal
  try {
    Object.defineProperty(to, 'name', { value: from.name, configurable: true });
    Object.defineProperty(to, 'length', { value: from.length, configurable: true });
  } catch {
    /* ignore */
  }
  // Preserve reflect-metadata (NestJS stores route/guard metadata on the method function itself)
  const R = Reflect as any;
  if (typeof R.getOwnMetadataKeys === 'function') {
    for (const key of R.getOwnMetadataKeys(from)) {
      R.defineMetadata(key, R.getOwnMetadata(key, from), to);
    }
  }
  // Preserve arbitrary own props (e.g. swagger, custom decorators)
  for (const key of Reflect.ownKeys(from)) {
    if (key === 'name' || key === 'length' || key === 'prototype' || key === 'arguments' || key === 'caller') continue;
    if (Object.prototype.hasOwnProperty.call(to, key)) continue;
    const d = Object.getOwnPropertyDescriptor(from, key);
    if (d) {
      try {
        Object.defineProperty(to, key, d);
      } catch {
        /* ignore */
      }
    }
  }
}

function isThenable(v: any): v is PromiseLike<unknown> {
  return v != null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

/**
 * Wrap a single function so that each call made inside an active trace
 * becomes a child span of whatever span is currently executing.
 * Calls made outside a trace are pass-through with ~zero overhead.
 */
export function wrapFunction<T extends Function>(fn: T, meta: WrapMeta = {}): T {
  if (typeof fn !== 'function' || isWrapped(fn) || isClass(fn)) return fn;
  const method = meta.method || fn.name || 'anonymous';
  let params: string[] | undefined;

  const traced = function (this: any, ...args: any[]) {
    const ctx = traceContext.getStore();
    if (!ctx || ctx.trace.finished || !tracer.opts.enabled) return fn.apply(this, args);

    const className = typeof meta.className === 'function' ? meta.className(this) : meta.className;
    const kind = (typeof meta.kind === 'function' ? meta.kind(this) : meta.kind) ?? kindFromName(className, 'function');
    params ??= getParamNames(fn);
    const call = tracer.beginCall(ctx.trace, ctx.spanId, {
      name: className ? `${className}.${method}` : method,
      className,
      method,
      kind,
      params,
    });
    if (call.mode === 'dropped') return fn.apply(this, args);

    // Repeated call folded into an aggregate span: no value capture (the expensive part), only
    // timing. It still runs as the aggregate's child context, so calls it makes (e.g. a query per
    // loop item) are counted under it and collapse the same way.
    if (call.mode === 'collapsed') {
      const done = (err?: unknown, isAsync = false) => tracer.endCollapsed(ctx.trace, call, args, isAsync, err);
      let result: any;
      try {
        result = traceContext.run({ trace: ctx.trace, spanId: call.aggregate.id }, () => fn.apply(this, args));
      } catch (err) {
        done(err);
        throw err;
      }
      if (result instanceof Promise) {
        return result.then(
          (v) => {
            done(undefined, true);
            return v;
          },
          (err) => {
            done(err ?? new Error('rejected'), true);
            throw err;
          },
        );
      }
      if (isThenable(result) && !(typeof (result as any).getQuery === 'function')) {
        try {
          (result as PromiseLike<unknown>).then(
            () => done(undefined, true),
            (err) => done(err, true),
          );
        } catch {
          done();
        }
        return result;
      }
      done();
      return result;
    }

    const span = call.span;
    tracer.captureArgs(ctx.trace, span, args);

    let result: any;
    try {
      result = traceContext.run({ trace: ctx.trace, spanId: span.id }, () => fn.apply(this, args));
    } catch (err) {
      tracer.endSpan(ctx.trace, span, undefined, err);
      throw err;
    }

    if (result instanceof Promise) {
      span.async = true;
      return result.then(
        (v) => {
          tracer.endSpan(ctx.trace, span, v);
          return v;
        },
        (err) => {
          tracer.endSpan(ctx.trace, span, undefined, err ?? new Error('rejected'));
          throw err;
        },
      );
    }
    if (isThenable(result) && !(typeof (result as any).getQuery === 'function')) {
      // Custom thenable (keep identity, just observe)
      span.async = true;
      try {
        (result as PromiseLike<unknown>).then(
          (v) => tracer.endSpan(ctx.trace, span, v),
          (err) => tracer.endSpan(ctx.trace, span, undefined, err),
        );
      } catch {
        tracer.endSpan(ctx.trace, span, result);
      }
      return result;
    }
    tracer.endSpan(ctx.trace, span, result);
    return result;
  };

  Object.defineProperty(traced, WRAPPED, { value: true });
  Object.defineProperty(traced, ORIGINAL, { value: fn });
  copyMetadata(fn, traced);
  return traced as unknown as T;
}

export function unwrap<T extends Function>(fn: T): T {
  return ((fn as any)?.[ORIGINAL] as T) ?? fn;
}

function shouldWrapKey(key: string, opts: InstrumentOptions) {
  if (ALWAYS_SKIP.has(key) || key.startsWith('__')) return false;
  if (tracer.isIgnoredMethod(key)) return false;
  if (opts.include && !matches(opts.include, key)) return false;
  if (matches(opts.exclude, key)) return false;
  return true;
}

function dynamicClassName(fixed?: string) {
  return (self: any): string | undefined => {
    if (fixed) return fixed;
    if (!self) return undefined;
    // TypeORM repositories: show `UserRepository` instead of `Repository`
    const entity = self.metadata?.name ?? (typeof self.target === 'function' ? self.target.name : undefined);
    const ctor = self.constructor?.name;
    if (ctor === 'Repository' || ctor === 'TreeRepository' || ctor === 'MongoRepository') {
      return entity ? `${entity}Repository` : ctor;
    }
    return ctor;
  };
}

/** Patch every method on a single prototype object (non-recursive). */
function patchProto(proto: any, opts: InstrumentOptions) {
  if (!proto || STOP_PROTOS.has(proto) || PATCHED_PROTOS.has(proto)) return;
  PATCHED_PROTOS.add(proto);
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (!shouldWrapKey(key, opts)) continue;
    const d = Object.getOwnPropertyDescriptor(proto, key);
    if (!d || !('value' in d) || typeof d.value !== 'function' || (!d.writable && !d.configurable)) continue;
    if (isWrapped(d.value) || isClass(d.value)) continue;
    const wrapped = wrapFunction(d.value, {
      className: dynamicClassName(opts.name),
      method: key,
      kind: opts.kind ?? ((self: any) => kindFromName(dynamicClassName()(self), 'service')),
    });
    try {
      Object.defineProperty(proto, key, { ...d, value: wrapped });
    } catch {
      /* frozen */
    }
  }
}

/**
 * Instrument a class: patches the prototype chain (up to, but excluding, Object / EventEmitter),
 * so every existing and future instance is traced.
 */
export function instrumentClass<T extends Function>(Cls: T, opts: InstrumentOptions = {}): T {
  if (typeof Cls !== 'function') return Cls;
  let proto = Cls.prototype;
  while (proto && !STOP_PROTOS.has(proto)) {
    patchProto(proto, { ...opts, kind: opts.kind ?? kindFromName(opts.name ?? Cls.name, 'service') });
    proto = Object.getPrototypeOf(proto);
  }
  // static methods
  for (const key of Object.getOwnPropertyNames(Cls)) {
    if (['length', 'name', 'prototype', 'caller', 'arguments'].includes(key) || !shouldWrapKey(key, opts)) continue;
    const d = Object.getOwnPropertyDescriptor(Cls, key);
    if (d && 'value' in d && typeof d.value === 'function' && !isWrapped(d.value) && !isClass(d.value) && d.writable) {
      (Cls as any)[key] = wrapFunction(d.value, {
        className: opts.name ?? Cls.name,
        method: key,
        kind: opts.kind ?? kindFromName(opts.name ?? Cls.name, 'service'),
      });
    }
  }
  return Cls;
}

/**
 * Instrument an object or class instance.
 * - Class instances: their prototype chain is patched (shared by all instances)
 * - Own function properties (arrow-function class fields, object literals, module exports) are replaced in place
 */
export function instrument<T extends object>(target: T, opts: InstrumentOptions = {}): T {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return target;
  if (typeof target === 'function') {
    return (isClass(target) ? instrumentClass(target as any, opts) : target) as T;
  }
  const proto = Object.getPrototypeOf(target);
  const ctorName = proto && proto !== Object.prototype ? proto.constructor?.name : undefined;
  const label = opts.name ?? ctorName;
  if (proto && !STOP_PROTOS.has(proto)) {
    let p = proto;
    while (p && !STOP_PROTOS.has(p)) {
      patchProto(p, opts);
      p = Object.getPrototypeOf(p);
    }
  }
  for (const key of Object.keys(target)) {
    if (!shouldWrapKey(key, opts)) continue;
    const d = Object.getOwnPropertyDescriptor(target, key);
    if (!d || !('value' in d) || !d.writable) continue;
    const v = d.value;
    if (typeof v !== 'function' || isWrapped(v)) continue;
    if (isClass(v)) {
      instrumentClass(v, { ...opts, name: undefined });
      continue;
    }
    (target as any)[key] = wrapFunction(v, {
      className: label,
      method: key,
      kind: opts.kind ?? kindFromName(label, 'function'),
    });
  }
  return target;
}

/* ------------------------------------------------------------------ */
/* Decorators (TypeScript `experimentalDecorators`, works with NestJS) */
/* ------------------------------------------------------------------ */

/**
 * `@Traced()` on a class → trace all methods.
 * `@Traced()` on a method → trace only that method.
 */
export function Traced(opts: InstrumentOptions = {}): any {
  return (target: any, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (key === undefined) {
      instrumentClass(target, opts);
      return target;
    }
    if (descriptor && typeof descriptor.value === 'function') {
      const className = opts.name ?? target.constructor?.name;
      descriptor.value = wrapFunction(descriptor.value, {
        className,
        method: String(key),
        kind: opts.kind ?? kindFromName(className, 'function'),
      });
      return descriptor;
    }
  };
}
