/**
 * @stacklens/types — the wire contract between the StackLens SDK (`@stacklens/node-tracer`)
 * and the StackLens server. Anything that crosses the network lives here.
 *
 * Versioning: additive changes only within a major version. The server must accept
 * traces from any SDK of the same major version.
 */

/** Architectural layer a span belongs to. Drives colours and grouping in the UI. */
export type SpanKind = 'http' | 'controller' | 'handler' | 'service' | 'repository' | 'db' | 'function' | 'job';

export type SpanStatus = 'ok' | 'error' | 'pending';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** A console line (or `stacklens.log()` call) captured while a span was executing. */
export interface SpanLog {
  /** Milliseconds since the trace started. */
  t: number;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export interface SpanError {
  name: string;
  message: string;
  stack?: string;
  /** HTTP status carried by the error (NestJS `HttpException`, `http-errors`, …). */
  status?: number;
}

/** One instrumented function call. */
export interface SpanRecord {
  id: string;
  /** `null` for the root span of a trace. */
  parentId: string | null;
  /** Display name, usually `ClassName.method`. */
  name: string;
  className?: string;
  method: string;
  kind: SpanKind;
  /** Milliseconds since the trace started (fractional). */
  start: number;
  /** Milliseconds (fractional). */
  duration: number;
  status: SpanStatus;
  /** The call returned a promise. */
  async: boolean;
  /** Parameter names parsed from the function source. */
  params: string[];
  /** Serialized arguments (see "Serialized values" in the SDK docs). */
  args?: unknown[];
  /** Inferred TypeScript-like type of each argument. */
  argTypes?: string[];
  result?: unknown;
  resultType?: string;
  error?: SpanError;
  logs?: SpanLog[];
  attributes?: Record<string, unknown>;
  /**
   * Set on a span that stands for many repeated calls of the same function under the same parent
   * (e.g. a helper called in a 10,000-item loop). `start` is the first collapsed call, `duration`
   * the wall-clock window until the last one finished. Calls made inside them are nested under it.
   */
  collapsed?: CollapsedCalls;
  /** Arguments and result were not captured because the trace used up its capture budget. */
  valuesDropped?: boolean;
  /** Log lines dropped after `maxLogsPerSpan`. */
  droppedLogs?: number;
  /** Set on a span that stands for an outgoing HTTP call (kind `http`) made inside the trace. */
  outbound?: OutboundCall;
}

/**
 * An outgoing HTTP call (node `http`/`https`, `fetch`, axios, …). When the callee is instrumented too,
 * its trace carries `parent: { traceId, spanId }` pointing at this span, so the two call trees can be joined.
 */
export interface OutboundCall {
  method: string;
  /** Absolute URL; query values of secret-looking keys are redacted. */
  url: string;
  /** `hostname[:port]` of the callee. */
  host: string;
  statusCode?: number;
  /** A W3C `traceparent` header was sent with the request. */
  propagated?: boolean;
  /** Trace id the callee reported back (`x-stacklens-trace-id` response header). */
  childTraceId?: string;
}

/** The SDK that recorded a trace. Lets the UI show the language and use its idioms (type names, signatures). */
export interface SdkInfo {
  /** Package name, e.g. `@stacklens/node-tracer` or `stacklens-python-tracer`. */
  name: string;
  /** SDK version, e.g. `0.1.0`. */
  version?: string;
  /** Language of the instrumented app, lower-case: `node`, `python`, … */
  language: string;
  /** Runtime and its version, e.g. `Node.js 22.12.0` or `CPython 3.12.4`. */
  runtime?: string;
}

/** The call that caused this trace in another service (from an incoming W3C `traceparent` header). */
export interface TraceParent {
  /** Trace id in the calling service. */
  traceId: string;
  /** Id of the outgoing-call span in the calling service. */
  spanId: string;
  /** Application name of the caller, when it sent one (`tracestate: stacklens=<name>`). */
  service?: string;
}

export interface CollapsedCalls {
  /** Calls folded into this span (not counting the ones recorded individually before it). */
  count: number;
  /** Sum of the calls' own durations (ms). */
  totalDuration: number;
  minDuration: number;
  maxDuration: number;
  /** Collapsed calls that threw. The first few failures are recorded as their own sibling spans instead and are not counted here. */
  errors: number;
}

export interface HttpExchange {
  method: string;
  url: string;
  /** Route pattern, e.g. `/users/:id`. */
  route?: string;
  statusCode?: number;
  ip?: string;
  request?: { headers?: unknown; query?: unknown; params?: unknown; body?: unknown };
  response?: { headers?: unknown; body?: unknown };
}

/** A complete request (or background job) with its full call tree. */
export interface TraceRecord {
  id: string;
  /** Same as `application`; kept for backwards compatibility with 0.x SDKs. */
  service: string;
  application?: string;
  project?: string;
  environment?: string;
  /** End user that made the request. */
  userId?: string;
  name: string;
  kind: 'http' | 'job';
  /** Epoch milliseconds. */
  startTime: number;
  duration: number;
  status: SpanStatus;
  http?: HttpExchange;
  /** Flat list; build the tree with `parentId`. The root span comes first. */
  spans: SpanRecord[];
  /** `true` when `maxSpansPerTrace` was hit and later spans were dropped. */
  truncated?: boolean;
  /** Calls not recorded at all because `maxSpansPerTrace` was reached. */
  droppedSpans?: number;
  /** Some spans have no arguments/result because the trace hit `maxCaptureBytes`. */
  valuesTruncated?: boolean;
  /** Set when another instrumented service made the request that started this trace. */
  parent?: TraceParent;
  /** Which SDK (and language) recorded the trace. Optional; older SDKs don't send it. */
  sdk?: SdkInfo;
}

/** Body of `POST /api/ingest`. A single `TraceRecord` is also accepted. */
export interface IngestRequest {
  traces: TraceRecord[];
}

export interface IngestResponse {
  accepted: number;
}

/** Default port of the StackLens server. */
export const DEFAULT_SERVER_PORT = 4300;

/** Path of the ingest endpoint on the StackLens server. */
export const INGEST_PATH = '/api/ingest';
