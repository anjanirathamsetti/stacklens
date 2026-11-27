import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { SpanRecord, TraceRecord } from '../types';

/** A trace that is still being recorded. */
/** Repeated calls of one function under one parent (see `maxRepeatedCalls`). */
export interface SiblingGroup {
  /** calls recorded as individual spans so far */
  recorded: number;
  /** the aggregate span, created at the first call over the limit */
  aggregate?: SpanRecord;
  /** failing collapsed calls that were still recorded individually */
  errorsKept: number;
}

export interface ActiveTrace {
  record: TraceRecord;
  /** `performance.now()` when the trace started; span offsets are relative to it. */
  t0: number;
  spanCount: number;
  /** span id → span, for O(1) lookups (logs, collapsing) */
  byId: Map<string, SpanRecord>;
  /** `${parentId}\u0000${name}` → repeated-call bookkeeping */
  siblings: Map<string, SiblingGroup>;
  /** approximate JSON bytes of captured values so far (see `maxCaptureBytes`) */
  captureBytes: number;
  /** Set once the trace has been handed to the exporter; later spans are ignored. */
  finished: boolean;
}

/** What AsyncLocalStorage carries through `await`s: the trace and the currently executing span. */
export interface TraceContext {
  trace: ActiveTrace;
  spanId: string;
}

export const traceContext = new AsyncLocalStorage<TraceContext>();

/** Random hex id (16 bytes for traces, 8 for spans – same widths as W3C trace context). */
export const newId = (bytes = 8): string => randomBytes(bytes).toString('hex');
