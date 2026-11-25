import { performance } from 'node:perf_hooks';
import { capture, inferType, serialize, type SerializeLimits } from '../serialization';
import type { LogLevel, SpanKind, SpanRecord, StackLensOptions, TraceRecord } from '../types';
import { originalConsole } from './console';
import { newId, traceContext, type ActiveTrace, type TraceContext } from './context';
import { toSpanError } from './errors';
import { HttpExporter } from './exporter';
import { cachedMatcher, matcher, resolveOptions, type ResolvedOptions } from './options';

export interface SpanInit {
  name: string;
  method: string;
  className?: string;
  kind: SpanKind;
  params: string[];
}

/**
 * The tracer runtime: holds configuration, creates traces and spans, captures values and
 * hands finished traces to the exporter. One process-wide instance: `tracer`.
 */
export class Tracer {
  opts: ResolvedOptions;
  limits!: SerializeLimits;
  isIgnoredMethod!: (name: string) => boolean;
  private readonly exporter = new HttpExporter({ endpoint: () => this.opts.endpoint, debug: () => this.opts.debug });

  constructor() {
    this.opts = resolveOptions({});
    this.applyLimits();
  }

  configure(o: StackLensOptions): void {
    const { application, ...rest } = this.opts;
    // an explicit serviceName in a later call wins over the previously resolved application
    this.opts = resolveOptions({ ...rest, application: o.application ?? o.serviceName ?? application, ...o });
    this.applyLimits();
  }

  private applyLimits(): void {
    this.limits = {
      maxDepth: this.opts.maxDepth,
      maxStringLength: this.opts.maxStringLength,
      maxArrayLength: this.opts.maxArrayLength,
      maxObjectKeys: this.opts.maxObjectKeys,
      redact: cachedMatcher(this.opts.redactKeys),
    };
    this.isIgnoredMethod = matcher(this.opts.ignoreMethods);
  }

  /* ----------------------------- values ----------------------------- */

  serialize(v: unknown): unknown {
    return serialize(v, this.limits);
  }

  /** Serialized value + inferred type in a single walk (the per-call hot path). */
  capture(v: unknown): { value: unknown; type?: string } {
    return capture(v, this.limits, this.opts.inferTypes);
  }

  inferType(v: unknown): string {
    return inferType(v);
  }

  /* ----------------------------- traces ----------------------------- */

  current(): TraceContext | undefined {
    return traceContext.getStore();
  }

  shouldSample(): boolean {
    return this.opts.enabled && (this.opts.sampleRate >= 1 || Math.random() < this.opts.sampleRate);
  }

  isIgnoredPath(path: string): boolean {
    return this.opts.ignorePaths.some((p) => (typeof p === 'string' ? path.startsWith(p) : p.test(path)));
  }

  /** Create a new trace together with its root span. */
  createTrace(name: string, kind: 'http' | 'job', rootKind: SpanKind): { trace: ActiveTrace; root: SpanRecord } {
    const trace: ActiveTrace = {
      t0: performance.now(),
      spanCount: 0,
      finished: false,
      record: {
        id: newId(16),
        service: this.opts.application,
        application: this.opts.application,
        project: this.opts.project,
        environment: this.opts.environment,
        name,
        kind,
        startTime: Date.now(),
        duration: 0,
        status: 'pending',
        spans: [],
      },
    };
    const root = this.startSpan(trace, null, { name, method: name, kind: rootKind, params: [] })!;
    return { trace, root };
  }

  /** Returns `undefined` when the trace is finished or `maxSpansPerTrace` was reached. */
  startSpan(trace: ActiveTrace, parentId: string | null, s: SpanInit): SpanRecord | undefined {
    if (trace.finished) return undefined;
    if (trace.spanCount >= this.opts.maxSpansPerTrace) {
      trace.record.truncated = true;
      return undefined;
    }
    trace.spanCount++;
    const span: SpanRecord = {
      id: newId(8),
      parentId,
      name: s.name,
      className: s.className,
      method: s.method,
      kind: s.kind,
      start: performance.now() - trace.t0,
      duration: 0,
      status: 'pending',
      async: false,
      params: s.params,
    };
    trace.record.spans.push(span);
    return span;
  }

  endSpan(trace: ActiveTrace, span: SpanRecord, result?: unknown, error?: unknown): void {
    span.duration = performance.now() - trace.t0 - span.start;
    if (error !== undefined) {
      span.status = 'error';
      span.error = toSpanError(error);
      return;
    }
    span.status = 'ok';
    if (this.opts.captureResults && result !== undefined) {
      const c = this.capture(result);
      span.result = c.value;
      if (c.type !== undefined) span.resultType = c.type;
    }
  }

  /** Attach a log line to the currently executing span. Returns `false` outside a trace. */
  addLog(level: LogLevel, args: unknown[]): boolean {
    const ctx = traceContext.getStore();
    if (!ctx || ctx.trace.finished) return false;
    const span = ctx.trace.record.spans.find((s) => s.id === ctx.spanId);
    if (!span) return false;
    const objects = args.filter((a) => typeof a === 'object' && a !== null);
    (span.logs ??= []).push({
      t: performance.now() - ctx.trace.t0,
      level,
      message: args
        .filter((a) => typeof a !== 'object' || a === null)
        .map(String)
        .join(' '),
      data: objects.length === 0 ? undefined : this.serialize(objects.length === 1 ? objects[0] : objects),
    });
    return true;
  }

  /** Close the root span and export the trace once fire-and-forget work has had `settleMs` to finish. */
  finishTrace(trace: ActiveTrace, root: SpanRecord, error?: unknown): void {
    if (trace.finished) return;
    this.endSpan(trace, root, undefined, error);
    trace.record.duration = root.duration;
    const failed = root.status === 'error' || (trace.record.http?.statusCode ?? 0) >= 500;
    trace.record.status = failed ? 'error' : 'ok';
    traceContext.exit(() => {
      setTimeout(() => {
        trace.finished = true;
        this.export(trace.record);
      }, this.opts.settleMs).unref?.();
    });
  }

  export(record: TraceRecord): void {
    if (!this.opts.exporter) return this.exporter.enqueue(record);
    try {
      this.opts.exporter(record);
    } catch (e) {
      if (this.opts.debug) originalConsole.warn('[stacklens] exporter error', e);
    }
  }

  flush(): Promise<void> {
    return this.exporter.flush();
  }
}

/** The process-wide tracer instance. */
export const tracer = new Tracer();
