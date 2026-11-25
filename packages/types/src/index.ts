/**
 * @stacklens/types — the wire contract between the StackLens SDK (`@stacklens/tracer`)
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
