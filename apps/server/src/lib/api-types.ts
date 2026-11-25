/**
 * Types of the server's HTTP API (what the UI fetches). The trace format the SDK sends is
 * the shared contract in `@stacklens/types`, re-exported here so UI code has one import site.
 */
export type { HttpExchange, LogLevel, SpanError, SpanKind, SpanLog, SpanRecord, SpanStatus, TraceRecord } from '@stacklens/types';
import type { SpanKind, SpanStatus } from '@stacklens/types';

export interface ErrorRef {
  spanName: string;
  kind: SpanKind;
  name: string;
  message: string;
  status?: number;
}

export interface TraceSummary {
  id: string;
  service: string;
  application: string;
  project: string;
  environment?: string;
  userId?: string;
  name: string;
  kind: 'http' | 'job';
  startTime: number;
  duration: number;
  status: SpanStatus;
  method?: string;
  url?: string;
  route?: string;
  statusCode?: number;
  spanCount: number;
  errorCount: number;
  maxDepth: number;
  truncated?: boolean;
  /** self time per layer (ms) */
  kindTime: Partial<Record<SpanKind, number>>;
  /** where errors originated */
  errors: ErrorRef[];
  /** false once the full payload was evicted (summary kept for metrics) */
  hasPayload?: boolean;
}

export interface Facets {
  applications: string[];
  projects: string[];
  environments: string[];
  /** project -> applications */
  projectApps: Record<string, string[]>;
}

export interface MetricsBucket {
  t: number;
  count: number;
  errors: number;
  c2xx: number;
  c3xx: number;
  c4xx: number;
  c5xx: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  /** unique users in the bucket */
  users: number;
  /** average instrumented calls per request */
  spans: number;
}

export interface Totals {
  total: number;
  errors: number;
  errorRate: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  rpm: number;
  users: number;
  avgSpans: number;
}

export interface RouteStat {
  route: string;
  method?: string;
  application: string;
  count: number;
  errors: number;
  avg: number;
  p95: number;
}

export interface Metrics {
  from: number;
  to: number;
  bucketMs: number;
  totals: Totals;
  previous: Totals;
  series: MetricsBucket[];
  statusCodes: { '2xx': number; '3xx': number; '4xx': number; '5xx': number; other: number };
  layers: { kind: SpanKind; ms: number }[];
  routes: RouteStat[];
  applications: { application: string; project: string; count: number; errors: number; avg: number; p95: number }[];
  users: { userId: string; count: number; errors: number; avg: number; lastSeen: number }[];
}

export interface ErrorGroup {
  key: string;
  /** stable short id (hash of key) used to link incidents */
  id: string;
  status?: number;
  severity: 'error' | 'warning';
  incident?: IncidentRef;
  name: string;
  message: string;
  spanName: string;
  kind: SpanKind;
  count: number;
  traces: number;
  users: number;
  firstSeen: number;
  lastSeen: number;
  routes: string[];
  applications: string[];
  sampleTraceId: string;
  series: number[];
}

export interface Hotspot {
  name: string;
  kind: SpanKind;
  calls: number;
  errors: number;
  avg: number;
  p95: number;
  max: number;
  totalSelf: number;
  traces: number;
  argTypes?: string[];
  resultType?: string;
  params: string[];
  async: boolean;
  lastTraceId: string;
}

export interface WorkNote {
  at: number;
  author: string;
  text: string;
}

export interface Incident {
  sysId: string;
  number: string;
  shortDescription: string;
  description?: string;
  state: string;
  stateCode: number;
  priority: string;
  priorityCode: number;
  urgency: number;
  impact: number;
  assignedTo?: string;
  assignmentGroup?: string;
  openedAt: number;
  updatedAt: number;
  resolvedAt?: number;
  correlationId?: string;
  /** StackLens error group id parsed from correlation_id */
  errorId?: string;
  url?: string;
  workNotes?: WorkNote[];
}

export interface IncidentRef {
  sysId: string;
  number: string;
  state: string;
  stateCode: number;
  priority: string;
  priorityCode: number;
  url?: string;
  openedAt: number;
}

export interface IncidentSource {
  mode: 'servicenow' | 'demo';
  instance?: string;
  error?: string;
}
