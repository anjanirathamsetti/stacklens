/**
 * Types of the server's HTTP API (what the UI fetches). The trace format the SDK sends is
 * the shared contract in `@stacklens/types`, re-exported here so UI code has one import site.
 */
export type {
  HttpExchange,
  LogLevel,
  OutboundCall,
  SdkInfo,
  SpanError,
  SpanKind,
  SpanLog,
  SpanRecord,
  SpanStatus,
  TraceParent,
  TraceRecord,
} from '@stacklens/types';
import type { SpanKind, SpanStatus, TraceParent } from '@stacklens/types';

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
  /** the outgoing call in another service that caused this trace */
  parent?: TraceParent;
  /** outgoing HTTP calls the request made (including ones folded into repeated-call rows) */
  outboundCount?: number;
  /** distinct hosts those calls went to (first 10) */
  outboundHosts?: string[];
  /** traces of called services stored on this server that link back to this trace */
  linkedChildren?: number;
  /** language of the SDK that recorded it (`trace.sdk.language`): `node`, `python`; only in trace lists */
  language?: string;
}

/** `GET /api/traces/:id/links` – how a trace connects to traces of other services. */
export interface TraceLinks {
  /** The calling service's trace; `trace` is missing when it isn't stored on this server. */
  parent?: TraceParent & { trace?: TraceSummary };
  /** Traces of called services, keyed by the outgoing-call span (`spanId`) in this trace. */
  children: { spanId: string; trace: TraceSummary }[];
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

/* ----------------------------- Saved views ----------------------------- */

export interface SavedView {
  id: string;
  name: string;
  /** page the view opens, e.g. `/traces` */
  path: string;
  /** URL query string without the leading `?` */
  query: string;
  description?: string;
  /** shown in the sidebar */
  pinned: boolean;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

/* --------------------------------- SLOs -------------------------------- */

export interface SloInput {
  name: string;
  application: string;
  /** undefined = any method */
  method?: string;
  route: string;
  /** a request is "fast" when it finishes within this many ms */
  latencyMs: number;
  /** fraction of requests that must be fast, e.g. 0.95 */
  latencyTarget: number;
  /** fraction of requests that must not fail with a server error, e.g. 0.999 */
  availabilityTarget: number;
  windowDays: number;
}

export interface Slo extends SloInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export type SloState = 'healthy' | 'at-risk' | 'breached' | 'no-data';

export interface SloObjective {
  target: number;
  /** good / total over the window (1 when there is no traffic) */
  attained: number;
  bad: number;
  /** share of the error budget still unspent; negative once the objective is missed */
  budgetLeft: number;
  /** how fast the budget burned over the last hour (1 = exactly on budget) */
  burnRate1h: number;
}

export interface SloStatus extends Slo {
  state: SloState;
  total: number;
  p95: number;
  latency: SloObjective;
  availability: SloObjective;
  /** one point per day of the window, oldest first */
  daily: { day: number; total: number; fast: number; available: number }[];
}

/* -------------------------------- Digest ------------------------------- */

export interface DigestRoute {
  application: string;
  method?: string;
  route: string;
  count: number;
  errors: number;
  p95: number;
  /** p95 in the period before, when there was traffic */
  previousP95?: number;
}

export interface Digest {
  from: number;
  to: number;
  generatedAt: number;
  totals: Totals;
  previous: Totals;
  /** error groups first seen in this period */
  newErrors: ErrorGroup[];
  topErrors: ErrorGroup[];
  slowestRoutes: DigestRoute[];
  /** routes whose p95 grew the most compared with the period before */
  regressions: DigestRoute[];
  busiestRoutes: DigestRoute[];
  slos: SloStatus[];
}

export interface DigestConfig {
  enabled: boolean;
  /** local hour of day (0–23) the digest is sent, in `timezone` */
  hour: number;
  timezone: string;
  /** Slack incoming webhook or any URL that accepts a JSON POST */
  webhookUrl: string;
  /** 'slack' formats the message with Slack blocks; 'json' posts the raw digest */
  format: 'slack' | 'json';
  /** limit the digest to one project (empty = all) */
  project: string;
  lastSentAt?: number;
  lastError?: string;
}

/* ------------------------- AI & MCP (UI layout) ------------------------ */

export type AiProvider = 'anthropic' | 'openai' | 'azure-openai' | 'bedrock' | 'ollama' | 'openai-compatible';
export type AiFeatureId = 'explain-failure' | 'incident-draft' | 'nl-search' | 'explain-slowdown' | 'generate-tests' | 'error-summary';

export interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  /** for self-hosted / compatible endpoints */
  baseUrl: string;
  features: Record<AiFeatureId, boolean>;
  privacy: {
    /** run the tracer's redaction again on the server before sending */
    redact: boolean;
    /** send argument / return values (otherwise only names, types and timings) */
    includeValues: boolean;
    /** extra keys to mask, comma separated */
    extraRedactKeys: string;
    maxSpans: number;
  };
  /** monthly spend cap in USD, 0 = no cap */
  monthlyBudgetUsd: number;
}

export type McpToolId =
  | 'search_traces'
  | 'get_trace'
  | 'get_span'
  | 'list_error_groups'
  | 'get_error_group'
  | 'get_hotspots'
  | 'get_metrics'
  | 'list_slos'
  | 'list_incidents';

export interface McpConfig {
  enabled: boolean;
  tools: Record<McpToolId, boolean>;
  /** restrict what clients can read (empty = everything) */
  projects: string[];
  /** strip argument / return values from tool results */
  redactPayloads: boolean;
  maxResults: number;
}

/* ------------------------------- Accounts ------------------------------ */

export type Role = 'admin' | 'member' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  lastLoginAt?: number;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  /** first characters of the key, e.g. `slk_9f3a` */
  prefix: string;
  scope: 'ingest';
  createdBy?: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface AuditEntry {
  id: number;
  at: number;
  actorEmail?: string;
  action: string;
  target?: string;
  details: Record<string, unknown>;
  ip?: string;
}

export interface SecurityConfig {
  /** reject trace batches without a valid API key */
  requireIngestKey: boolean;
  /** how long a login lasts without activity */
  sessionDays: number;
  minPasswordLength: number;
}
