/**
 * Public types of the SDK. The trace format itself (what is sent to the server) lives in
 * `@stacklens/types` and is re-exported here for convenience.
 */
export type {
  CollapsedCalls,
  HttpExchange,
  IngestRequest,
  LogLevel,
  SpanError,
  SpanKind,
  SpanLog,
  SpanRecord,
  SpanStatus,
  TraceRecord,
} from '@stacklens/types';
import type { SpanKind, TraceRecord } from '@stacklens/types';

export interface StackLensOptions {
  /** Application name shown in the dashboard. Default: STACKLENS_APP / package name */
  application?: string;
  /** Alias of `application` */
  serviceName?: string;
  /** Project / team the application belongs to. Default: STACKLENS_PROJECT or "default" */
  project?: string;
  /** Deployment environment. Default: STACKLENS_ENV / NODE_ENV / "development" */
  environment?: string;
  /**
   * Resolve the end-user id for a request. Called when the response finishes (after auth ran).
   * Default: req.user.id | req.user.userId | req.user.sub | req.auth.userId | `x-user-id` header
   */
  getUserId?: (req: any) => string | number | undefined | null;
  /** Collector URL. Default: http://localhost:4300/api/ingest */
  endpoint?: string;
  /**
   * API key from the StackLens admin (Admin → API keys), sent as `Authorization: Bearer …`.
   * Required when the server is set to reject traces without a key. Default: STACKLENS_API_KEY
   */
  apiKey?: string;
  /** Disable all tracing (wrappers become pass-through). Default: true unless STACKLENS_ENABLED=false */
  enabled?: boolean;
  /** 0..1 – fraction of requests to trace. Default 1 */
  sampleRate?: number;
  /** Capture function arguments. Default true */
  captureArgs?: boolean;
  /** Capture return values. Default true */
  captureResults?: boolean;
  /** Infer a TypeScript-like shape for args / results (great for `unknown` interfaces). Default true */
  inferTypes?: boolean;
  /** Attach console.* output made inside a traced call to that span. Default true */
  captureConsole?: boolean;
  /** Hard cap on spans per trace, the last line of defence. Default 2000 */
  maxSpansPerTrace?: number;
  /**
   * Repeated calls of the same function under the same parent (loops) are recorded individually
   * up to this many times; further calls are folded into one span with call count and timing stats.
   * `0` disables collapsing. Default 10
   */
  maxRepeatedCalls?: number;
  /**
   * Budget for captured argument/return values per trace, in approximate JSON bytes. Once used up,
   * later calls keep their timing and errors but not their values. Default 1_000_000 (≈1 MB)
   */
  maxCaptureBytes?: number;
  /** Log lines kept per span (console output in loops). Default 50 */
  maxLogsPerSpan?: number;
  /** Serializer limits */
  maxDepth?: number;
  maxStringLength?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  /** Keys whose values are replaced by "[REDACTED]" */
  redactKeys?: (string | RegExp)[];
  /** URL paths (string prefix or RegExp) that should not be traced */
  ignorePaths?: (string | RegExp)[];
  /** Method names that should never be wrapped */
  ignoreMethods?: (string | RegExp)[];
  /** Ms to wait after the response finishes before exporting (lets fire-and-forget work settle). Default 30 */
  settleMs?: number;
  /** Print exporter errors. Default true */
  debug?: boolean;
  /** Custom exporter – overrides the HTTP exporter */
  exporter?: (trace: TraceRecord) => void;
}

export interface InstrumentOptions {
  /** Override the class/object name shown for spans */
  name?: string;
  kind?: SpanKind;
  /** Only wrap these method names */
  include?: (string | RegExp)[];
  /** Skip these method names */
  exclude?: (string | RegExp)[];
}
