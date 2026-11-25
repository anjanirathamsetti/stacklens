import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { TraceRecord } from '../types';

/** A trace that is still being recorded. */
export interface ActiveTrace {
  record: TraceRecord;
  /** `performance.now()` when the trace started; span offsets are relative to it. */
  t0: number;
  spanCount: number;
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
