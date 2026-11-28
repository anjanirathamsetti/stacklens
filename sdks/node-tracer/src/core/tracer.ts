import { performance } from 'node:perf_hooks';
import { approxSize, capture, inferType, serialize, type SerializeLimits } from '../serialization';
import type { LogLevel, SpanKind, SpanRecord, StackLensOptions, TraceRecord } from '../types';
import { originalConsole } from './console';
import { newId, traceContext, type ActiveTrace, type SiblingGroup, type TraceContext } from './context';
import { toSpanError } from './errors';
import { HttpExporter } from './exporter';
import { cachedMatcher, matcher, resolveOptions, type ResolvedOptions } from './options';
import { hostMatcher } from './propagation';

export interface SpanInit {
  name: string;
  method: string;
  className?: string;
  kind: SpanKind;
  params: string[];
}

/**
 * What `beginCall` decided for one function call:
 *  - `span`: record it as its own span (the normal case)
 *  - `collapsed`: fold it into the group's aggregate span (repeated call over `maxRepeatedCalls`)
 *  - `dropped`: don't record it (`maxSpansPerTrace` reached); run the function untraced
 */
export type CallHandle =
  | { mode: 'span'; span: SpanRecord }
  | { mode: 'collapsed'; aggregate: SpanRecord; group: SiblingGroup; parentId: string | null; init: SpanInit; start: number }
  | { mode: 'dropped' };

/** Sent with every trace so the UI can show the language (see `SdkInfo` in the contract). */
const SDK_INFO = { name: '@stacklens/node-tracer', language: 'node', runtime: `Node.js ${process.versions.node}` };

/** Failing collapsed calls recorded individually per group (with their arguments), so errors stay debuggable. */
const KEEP_COLLAPSED_ERRORS = 3;

/**
 * The tracer runtime: holds configuration, creates traces and spans, captures values and
 * hands finished traces to the exporter. One process-wide instance: `tracer`.
 */
export class Tracer {
  opts: ResolvedOptions;
  limits!: SerializeLimits;
  isIgnoredMethod!: (name: string) => boolean;
  /** `propagateTo` as a predicate over `(hostname, host)`. */
  propagatesTo!: (hostname: string, host: string) => boolean;
  private readonly exporter = new HttpExporter({
    endpoint: () => this.opts.endpoint,
    apiKey: () => this.opts.apiKey,
    debug: () => this.opts.debug,
  });

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
    this.propagatesTo = hostMatcher(this.opts.propagateTo);
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
      byId: new Map(),
      siblings: new Map(),
      captureBytes: 0,
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
        sdk: SDK_INFO,
      },
    };
    const root = this.startSpan(trace, null, { name, method: name, kind: rootKind, params: [] })!;
    return { trace, root };
  }

  /** Returns `undefined` when the trace is finished or `maxSpansPerTrace` was reached. */
  startSpan(trace: ActiveTrace, parentId: string | null, s: SpanInit, start?: number): SpanRecord | undefined {
    if (trace.finished) return undefined;
    if (trace.spanCount >= this.opts.maxSpansPerTrace) {
      trace.record.truncated = true;
      trace.record.droppedSpans = (trace.record.droppedSpans ?? 0) + 1;
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
      start: start ?? performance.now() - trace.t0,
      duration: 0,
      status: 'pending',
      async: false,
      params: s.params,
    };
    trace.record.spans.push(span);
    trace.byId.set(span.id, span);
    return span;
  }

  /**
   * Start tracking one call of an instrumented function. The first `maxRepeatedCalls` calls of the
   * same function under the same parent get their own span; later ones are folded into a single
   * aggregate span, so a helper called in a 10,000-item loop costs one span instead of 10,000.
   */
  beginCall(trace: ActiveTrace, parentId: string | null, init: SpanInit): CallHandle {
    if (trace.finished) return { mode: 'dropped' };
    const limit = this.opts.maxRepeatedCalls;
    if (limit <= 0) {
      const span = this.startSpan(trace, parentId, init);
      return span ? { mode: 'span', span } : { mode: 'dropped' };
    }
    const key = `${parentId}\u0000${init.name}`;
    let group = trace.siblings.get(key);
    if (!group) trace.siblings.set(key, (group = { recorded: 0, errorsKept: 0 }));
    if (group.recorded < limit) {
      const span = this.startSpan(trace, parentId, init);
      if (!span) return { mode: 'dropped' };
      group.recorded++;
      return { mode: 'span', span };
    }
    const start = performance.now() - trace.t0;
    if (!group.aggregate) {
      const agg = this.startSpan(trace, parentId, { ...init }, start);
      if (!agg) return { mode: 'dropped' };
      agg.collapsed = { count: 0, totalDuration: 0, minDuration: Infinity, maxDuration: 0, errors: 0 };
      agg.status = 'ok';
      group.aggregate = agg;
    }
    return { mode: 'collapsed', aggregate: group.aggregate, group, parentId, init, start };
  }

  /** Finish a collapsed call: update the aggregate's stats; keep the first few failures as real spans. */
  endCollapsed(trace: ActiveTrace, h: Extract<CallHandle, { mode: 'collapsed' }>, args: unknown[], async: boolean, error?: unknown): void {
    const end = performance.now() - trace.t0;
    const agg = h.aggregate;
    if (async) agg.async = true;
    agg.duration = Math.max(agg.duration, end - agg.start);
    // the first few failures become real spans (with arguments) and are not counted in the aggregate
    if (error !== undefined && h.group.errorsKept < KEEP_COLLAPSED_ERRORS && !trace.finished) {
      const span = this.startSpan(trace, h.parentId, h.init, h.start);
      if (span) {
        h.group.errorsKept++;
        span.async = async;
        this.captureArgs(trace, span, args);
        this.endSpan(trace, span, undefined, error);
        return;
      }
    }
    const d = end - h.start;
    const c = agg.collapsed!;
    c.count++;
    c.totalDuration += d;
    if (d < c.minDuration) c.minDuration = d;
    if (d > c.maxDuration) c.maxDuration = d;
    if (error !== undefined) c.errors++;
  }

  /** Capture call arguments onto a span, within the trace's capture budget. */
  captureArgs(trace: ActiveTrace, span: SpanRecord, args: unknown[]): void {
    if (!this.opts.captureArgs) return;
    if (!this.hasBudget(trace, span)) return;
    const captured = args.map((a) => this.capture(a));
    span.args = captured.map((c) => c.value);
    if (this.opts.inferTypes) span.argTypes = captured.map((c) => c.type ?? 'unknown');
    trace.captureBytes += approxSize(span.args);
  }

  /** `false` (and marks the span) once the trace has used up `maxCaptureBytes`. */
  private hasBudget(trace: ActiveTrace, span: SpanRecord): boolean {
    if (trace.captureBytes < this.opts.maxCaptureBytes) return true;
    span.valuesDropped = true;
    trace.record.valuesTruncated = true;
    return false;
  }

  endSpan(trace: ActiveTrace, span: SpanRecord, result?: unknown, error?: unknown): void {
    span.duration = performance.now() - trace.t0 - span.start;
    if (error !== undefined) {
      span.status = 'error';
      span.error = toSpanError(error);
      return;
    }
    span.status = 'ok';
    if (this.opts.captureResults && result !== undefined && !trace.finished && this.hasBudget(trace, span)) {
      const c = this.capture(result);
      span.result = c.value;
      if (c.type !== undefined) span.resultType = c.type;
      trace.captureBytes += approxSize(c.value);
    }
  }

  /**
   * Capture a value that arrives after its span ended (e.g. a response body read later), within the
   * trace's capture budget. `undefined` when the trace was already exported or the budget is used up.
   */
  captureLate(trace: ActiveTrace, span: SpanRecord, value: unknown): unknown {
    if (trace.finished || !this.opts.captureResults || !this.hasBudget(trace, span)) return undefined;
    const c = this.capture(value);
    trace.captureBytes += approxSize(c.value);
    return c.value;
  }

  /** Attach a log line to the currently executing span. Returns `false` outside a trace. */
  addLog(level: LogLevel, args: unknown[]): boolean {
    const ctx = traceContext.getStore();
    if (!ctx || ctx.trace.finished) return false;
    const span = ctx.trace.byId.get(ctx.spanId);
    if (!span) return false;
    // console output in a loop: keep the first lines, count the rest
    if ((span.logs?.length ?? 0) >= this.opts.maxLogsPerSpan) {
      span.droppedLogs = (span.droppedLogs ?? 0) + 1;
      return true;
    }
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
        // an aggregate whose calls never finished has no minimum yet (Infinity isn't valid JSON)
        for (const g of trace.siblings.values())
          if (g.aggregate?.collapsed && g.aggregate.collapsed.count === 0) g.aggregate.collapsed.minDuration = 0;
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
