import 'server-only';
import type {
  ErrorGroup,
  Facets,
  Hotspot,
  Metrics,
  MetricsBucket,
  RouteStat,
  SpanKind,
  Totals,
  TraceRecord,
  TraceSummary,
} from '@stacklens/shared/api-types';
import { busyTime, callCount, selfTimes } from '@stacklens/shared/span-tree';
import { getDb, type Db } from '../db/client';
import { errorIdOf, errorStatus, summarize } from '../domain/trace-summary';

/** Channel used to tell every server replica that new traces arrived. */
export const TRACES_CHANNEL = 'stacklens_traces';

export interface TraceQuery {
  search?: string;
  /** ok | error | 2xx | 4xx | 5xx */
  status?: string;
  method?: string;
  application?: string;
  project?: string;
  environment?: string;
  userId?: string;
  route?: string;
  minDuration?: number;
  /** epoch ms */
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
  sort?: 'time' | 'duration' | 'calls' | 'errors' | 'status';
  order?: 'asc' | 'desc';
}

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

const SUMMARY_COLUMNS = `
  t.id, t.start_time, t.duration_ms, t.status, t.kind, t.name, t.application, t.project, t.environment, t.user_id,
  t.method, t.url, t.route, t.status_code, t.span_count, t.error_count, t.max_depth, t.truncated, t.kind_time, t.errors,
  (t.payload is not null) as has_payload`;

interface SummaryRow {
  id: string;
  start_time: Date | string;
  duration_ms: number;
  status: TraceSummary['status'];
  kind: TraceSummary['kind'];
  name: string;
  application: string;
  project: string;
  environment: string | null;
  user_id: string | null;
  method: string | null;
  url: string | null;
  route: string | null;
  status_code: number | null;
  span_count: number;
  error_count: number;
  max_depth: number;
  truncated: boolean;
  kind_time: TraceSummary['kindTime'];
  errors: TraceSummary['errors'];
  has_payload: boolean;
}

const ms = (d: Date | string | number) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

function toSummary(r: SummaryRow): TraceSummary {
  return {
    id: r.id,
    service: r.application,
    application: r.application,
    project: r.project,
    environment: opt(r.environment),
    userId: opt(r.user_id),
    name: r.name,
    kind: r.kind,
    startTime: ms(r.start_time),
    duration: Number(r.duration_ms),
    status: r.status,
    method: opt(r.method),
    url: opt(r.url),
    route: opt(r.route),
    statusCode: opt(r.status_code),
    spanCount: r.span_count,
    errorCount: r.error_count,
    maxDepth: r.max_depth,
    truncated: r.truncated || undefined,
    kindTime: r.kind_time,
    errors: r.errors,
    hasPayload: r.has_payload,
  };
}

/** Row shapes for `jsonb_to_recordset` bulk inserts (one parameter per batch). */
function traceRow(s: TraceSummary, payload: TraceRecord | null) {
  return {
    id: s.id,
    start_time: new Date(s.startTime).toISOString(),
    duration_ms: s.duration,
    status: s.status,
    kind: s.kind,
    name: s.name,
    application: s.application,
    project: s.project,
    environment: s.environment ?? null,
    user_id: s.userId ?? null,
    method: s.method ?? null,
    url: s.url ?? null,
    route: s.route ?? null,
    status_code: s.statusCode ?? null,
    span_count: s.spanCount,
    error_count: s.errorCount,
    max_depth: s.maxDepth,
    truncated: !!s.truncated,
    kind_time: s.kindTime ?? {},
    errors: s.errors ?? [],
    payload,
  };
}

function errorRows(s: TraceSummary) {
  return (s.errors ?? []).map((e) => ({
    trace_id: s.id,
    error_id: errorIdOf(s.application, e),
    start_time: new Date(s.startTime).toISOString(),
    application: s.application,
    span_name: e.spanName,
    span_kind: e.kind,
    name: e.name,
    message: e.message,
    status: errorStatus(e) ?? null,
    user_id: s.userId ?? null,
    method: s.method ?? null,
    route: s.route ?? s.name,
  }));
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

const TRACE_RECORDSET = `
  id text, start_time timestamptz, duration_ms double precision, status text, kind text, name text, application text,
  project text, environment text, user_id text, method text, url text, route text, status_code integer, span_count integer,
  error_count integer, max_depth integer, truncated boolean, kind_time jsonb, errors jsonb, payload jsonb`;

const ERROR_RECORDSET = `
  trace_id text, error_id text, start_time timestamptz, application text, span_name text, span_kind text, name text,
  message text, status integer, user_id text, method text, route text`;

/**
 * Store a batch of traces (idempotent on trace id) and notify listeners.
 * `payloads: false` stores summaries only – used when importing legacy summaries.
 */
export async function insertTraces(records: { summary: TraceSummary; payload: TraceRecord | null }[], db?: Db): Promise<number> {
  if (!records.length) return 0;
  const conn = db ?? (await getDb());
  const inserted = await conn.transaction(async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `insert into traces (id, start_time, duration_ms, status, kind, name, application, project, environment, user_id, method, url,
         route, status_code, span_count, error_count, max_depth, truncated, kind_time, errors, payload)
       select * from jsonb_to_recordset($1::jsonb) as x(${TRACE_RECORDSET})
       on conflict (id) do nothing
       returning id`,
      [JSON.stringify(records.map((r) => traceRow(r.summary, r.payload)))],
    );
    const ids = new Set(rows.map((r) => r.id));
    const errors = records.filter((r) => ids.has(r.summary.id)).flatMap((r) => errorRows(r.summary));
    if (errors.length) {
      await tx.query(`insert into error_events select * from jsonb_to_recordset($1::jsonb) as x(${ERROR_RECORDSET})`, [
        JSON.stringify(errors),
      ]);
    }
    return ids.size;
  });
  if (inserted) await conn.query('select pg_notify($1, $2)', [TRACES_CHANNEL, JSON.stringify({ count: inserted })]);
  return inserted;
}

/** Validate and store traces sent by SDKs. */
export async function ingestTraces(traces: TraceRecord[]): Promise<number> {
  const valid = traces.filter((t) => t && typeof t.id === 'string' && Array.isArray(t.spans) && typeof t.startTime === 'number');
  return insertTraces(valid.map((t) => ({ summary: summarize(t), payload: t })));
}

export async function clearTraces(): Promise<void> {
  const db = await getDb();
  await db.query('truncate traces cascade');
}

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

/** Builds a parameterized WHERE clause over the `traces t` alias. */
function whereClause(q: TraceQuery, opts: { search?: boolean; startIndex?: number } = {}) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length + (opts.startIndex ?? 0)}`;
  };
  if (q.from) parts.push(`t.start_time >= to_timestamp(${p(q.from / 1000)})`);
  if (q.to) parts.push(`t.start_time <= to_timestamp(${p(q.to / 1000)})`);
  if (q.project) parts.push(`t.project = ${p(q.project)}`);
  if (q.application) parts.push(`t.application = ${p(q.application)}`);
  if (q.environment) parts.push(`t.environment = ${p(q.environment)}`);
  if (q.userId) parts.push(`t.user_id ilike ${p(`%${q.userId}%`)}`);
  if (q.method) parts.push(`t.method = ${p(q.method)}`);
  if (q.route) parts.push(`t.route = ${p(q.route)}`);
  if (q.minDuration) parts.push(`t.duration_ms >= ${p(q.minDuration)}`);
  if (q.status === 'error') parts.push(`(t.status = 'error' or t.error_count > 0)`);
  if (q.status === 'ok') parts.push(`(t.status <> 'error' and t.error_count = 0)`);
  if (q.status === '2xx') parts.push(`t.status_code between 200 and 299`);
  if (q.status === '4xx') parts.push(`t.status_code between 400 and 499`);
  if (q.status === '5xx') parts.push(`t.status_code >= 500`);
  if (opts.search !== false && q.search) {
    const s = p(`%${q.search}%`);
    parts.push(`(t.name ilike ${s} or t.url ilike ${s} or t.id ilike ${s} or t.application ilike ${s} or t.user_id ilike ${s}
      or exists (select 1 from jsonb_array_elements(t.payload->'spans') sp where sp->>'name' ilike ${s}))`);
  }
  return { sql: parts.length ? `where ${parts.join(' and ')}` : '', params };
}

const SORT_COLUMNS: Record<NonNullable<TraceQuery['sort']>, string> = {
  time: 't.start_time',
  duration: 't.duration_ms',
  calls: 't.span_count',
  errors: 't.error_count',
  status: 'coalesce(t.status_code, 0)',
};

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** One page of trace summaries plus the total number of matches. */
export async function pageTraces(q: TraceQuery = {}): Promise<{ traces: TraceSummary[]; total: number }> {
  const db = await getDb();
  const limit = Math.min(500, Math.max(1, Number.isFinite(q.limit) ? Math.floor(q.limit!) : 200));
  const offset = Math.max(0, Number.isFinite(q.offset) ? Math.floor(q.offset!) : 0);
  const where = whereClause(q);
  const order = `${SORT_COLUMNS[q.sort ?? 'time'] ?? SORT_COLUMNS.time} ${q.order === 'asc' ? 'asc' : 'desc'}, t.start_time desc`;
  // page and count separately: a `count(*) over ()` window would materialize every matching row
  const [rows, total] = await Promise.all([
    db.query<SummaryRow>(
      `select ${SUMMARY_COLUMNS} from traces t ${where.sql} order by ${order} limit ${limit} offset ${offset}`,
      where.params,
    ),
    countTraces(db, q, where),
  ]);
  return { traces: rows.map(toSummary), total };
}

async function countTraces(db: Db, q: TraceQuery, where = whereClause(q)): Promise<number> {
  const [r] = await db.query<{ n: string }>(`select count(*) as n from traces t ${where.sql}`, where.params);
  return Number(r.n);
}

export async function getTrace(id: string): Promise<TraceRecord | undefined> {
  const db = await getDb();
  const [r] = await db.query<{ payload: TraceRecord | null }>('select payload from traces where id = $1', [id]);
  return r?.payload ?? undefined;
}

export async function getSummary(id: string): Promise<TraceSummary | undefined> {
  const db = await getDb();
  const [r] = await db.query<SummaryRow>(`select ${SUMMARY_COLUMNS} from traces t where t.id = $1`, [id]);
  return r ? toSummary(r) : undefined;
}

/** Distinct projects / applications / environments seen in the last 30 days. */
export async function getFacets(): Promise<Facets> {
  const db = await getDb();
  const rows = await db.query<{ project: string; application: string; environment: string | null }>(
    `select distinct project, application, environment from traces where start_time > now() - interval '30 days'`,
  );
  const projectApps: Record<string, Set<string>> = {};
  for (const r of rows) (projectApps[r.project] ??= new Set()).add(r.application);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    applications: uniq(rows.map((r) => r.application)),
    projects: uniq(rows.map((r) => r.project)),
    environments: uniq(rows.map((r) => r.environment)),
    projectApps: Object.fromEntries(Object.entries(projectApps).map(([k, v]) => [k, [...v].sort()])),
  };
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

const NICE_BUCKETS = [
  1_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000,
  43_200_000, 86_400_000,
];

/** Bucket size giving roughly `target` points across the range. */
export function bucketFor(rangeMs: number, target = 60): number {
  return NICE_BUCKETS.find((b) => b >= rangeMs / target) ?? NICE_BUCKETS[NICE_BUCKETS.length - 1];
}

function resolveRange(q: TraceQuery) {
  const to = q.to ?? Date.now();
  return { from: q.from ?? to - 3_600_000, to };
}

const IS_FAILED = `(t.status = 'error' or coalesce(t.status_code, 0) >= 500)`;

async function totals(db: Db, q: TraceQuery, rangeMs: number): Promise<Totals> {
  const where = whereClause(q, { search: false });
  const [r] = await db.query<Record<string, string | number | null>>(
    `select count(*) as total,
            count(*) filter (where ${IS_FAILED}) as errors,
            coalesce(avg(t.duration_ms), 0) as avg,
            coalesce(percentile_cont(0.5) within group (order by t.duration_ms), 0) as p50,
            coalesce(percentile_cont(0.95) within group (order by t.duration_ms), 0) as p95,
            coalesce(percentile_cont(0.99) within group (order by t.duration_ms), 0) as p99,
            count(distinct t.user_id) as users,
            coalesce(avg(t.span_count), 0) as spans
     from traces t ${where.sql}`,
    where.params,
  );
  const total = Number(r.total);
  const errors = Number(r.errors);
  return {
    total,
    errors,
    errorRate: total ? errors / total : 0,
    avg: Number(r.avg),
    p50: Number(r.p50),
    p95: Number(r.p95),
    p99: Number(r.p99),
    rpm: rangeMs > 0 ? total / (rangeMs / 60_000) : 0,
    users: Number(r.users),
    avgSpans: Number(r.spans),
  };
}

export async function getMetrics(q: TraceQuery = {}): Promise<Metrics> {
  const db = await getDb();
  const { from, to } = resolveRange(q);
  const range = Math.max(1, to - from);
  const bucketMs = bucketFor(range);
  const window = { ...q, from, to };
  const where = whereClause(window, { search: false });
  const bucketExpr = `(floor(extract(epoch from t.start_time) * 1000 / ${bucketMs}) * ${bucketMs})::bigint`;

  const [current, previous, seriesRows, layerRows, routeRows, appRows, userRows] = await Promise.all([
    totals(db, window, range),
    totals(db, { ...q, from: from - range, to: from }, range),
    db.query<Record<string, string | number>>(
      `select ${bucketExpr} as t, count(*) as count,
              count(*) filter (where ${IS_FAILED}) as errors,
              count(*) filter (where t.status_code between 200 and 299) as c2xx,
              count(*) filter (where t.status_code between 300 and 399) as c3xx,
              count(*) filter (where t.status_code between 400 and 499) as c4xx,
              count(*) filter (where t.status_code >= 500) as c5xx,
              avg(t.duration_ms) as avg,
              percentile_cont(0.5) within group (order by t.duration_ms) as p50,
              percentile_cont(0.95) within group (order by t.duration_ms) as p95,
              percentile_cont(0.99) within group (order by t.duration_ms) as p99,
              count(distinct t.user_id) as users,
              avg(t.span_count) as spans
       from traces t ${where.sql} group by 1 order by 1`,
      where.params,
    ),
    db.query<{ kind: SpanKind; ms: number }>(
      `select k.key as kind, sum((k.value)::double precision) as ms
       from traces t cross join lateral jsonb_each_text(t.kind_time) k ${where.sql} group by 1 order by 2 desc`,
      where.params,
    ),
    db.query<Record<string, string | number | null>>(
      `select t.application, t.method, coalesce(t.route, t.name) as route, count(*) as count,
              count(*) filter (where ${IS_FAILED}) as errors, avg(t.duration_ms) as avg,
              percentile_cont(0.95) within group (order by t.duration_ms) as p95
       from traces t ${where.sql} group by 1, 2, 3 order by 4 desc limit 12`,
      where.params,
    ),
    db.query<Record<string, string | number>>(
      `select t.application, min(t.project) as project, count(*) as count, count(*) filter (where ${IS_FAILED}) as errors,
              avg(t.duration_ms) as avg, percentile_cont(0.95) within group (order by t.duration_ms) as p95
       from traces t ${where.sql} group by 1 order by 3 desc`,
      where.params,
    ),
    db.query<Record<string, string | number | Date>>(
      `select t.user_id, count(*) as count,
              count(*) filter (where ${IS_FAILED} or coalesce(t.status_code, 0) >= 400) as errors,
              avg(t.duration_ms) as avg, max(t.start_time) as last_seen
       from traces t ${where.sql} ${where.sql ? 'and' : 'where'} t.user_id is not null group by 1 order by 2 desc limit 10`,
      where.params,
    ),
  ]);

  // fill the time axis, including empty buckets
  const byT = new Map(seriesRows.map((r) => [Number(r.t), r]));
  const start = Math.floor(from / bucketMs) * bucketMs;
  const n = Math.min(500, Math.ceil((to - start) / bucketMs));
  const series: MetricsBucket[] = Array.from({ length: n }, (_, i) => {
    const t = start + i * bucketMs;
    const r = byT.get(t);
    return {
      t,
      count: Number(r?.count ?? 0),
      errors: Number(r?.errors ?? 0),
      c2xx: Number(r?.c2xx ?? 0),
      c3xx: Number(r?.c3xx ?? 0),
      c4xx: Number(r?.c4xx ?? 0),
      c5xx: Number(r?.c5xx ?? 0),
      avg: Number(r?.avg ?? 0),
      p50: Number(r?.p50 ?? 0),
      p95: Number(r?.p95 ?? 0),
      p99: Number(r?.p99 ?? 0),
      users: Number(r?.users ?? 0),
      spans: Number(r?.spans ?? 0),
    };
  });
  const sum = (k: 'c2xx' | 'c3xx' | 'c4xx' | 'c5xx') => series.reduce((a, b) => a + b[k], 0);

  return {
    from,
    to,
    bucketMs,
    totals: current,
    previous,
    series,
    statusCodes: {
      '2xx': sum('c2xx'),
      '3xx': sum('c3xx'),
      '4xx': sum('c4xx'),
      '5xx': sum('c5xx'),
      other: current.total - sum('c2xx') - sum('c3xx') - sum('c4xx') - sum('c5xx'),
    },
    layers: layerRows.map((r) => ({ kind: r.kind, ms: Number(r.ms) })),
    routes: routeRows.map((r): RouteStat => ({
      route: String(r.route),
      method: (r.method as string | null) ?? undefined,
      application: String(r.application),
      count: Number(r.count),
      errors: Number(r.errors),
      avg: Number(r.avg),
      p95: Number(r.p95),
    })),
    applications: appRows.map((r) => ({
      application: String(r.application),
      project: String(r.project),
      count: Number(r.count),
      errors: Number(r.errors),
      avg: Number(r.avg),
      p95: Number(r.p95),
    })),
    users: userRows.map((r) => ({
      userId: String(r.user_id),
      count: Number(r.count),
      errors: Number(r.errors),
      avg: Number(r.avg),
      lastSeen: ms(r.last_seen as Date),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

const ERROR_SLOTS = 24;

export async function getErrorGroups(q: TraceQuery = {}): Promise<{ groups: ErrorGroup[]; from: number; to: number }> {
  const db = await getDb();
  const { from, to } = resolveRange(q);
  const where = whereClause({ ...q, from, to }, { search: false });
  const slotParam = where.params.length + 1;
  const rows = await db.query<Record<string, unknown>>(
    `select e.error_id,
            (array_agg(e.name order by e.start_time desc))[1] as name,
            (array_agg(e.message order by e.start_time desc))[1] as message,
            (array_agg(e.span_name order by e.start_time desc))[1] as span_name,
            (array_agg(e.span_kind order by e.start_time desc))[1] as span_kind,
            max(e.status) as status,
            count(*) as count,
            count(distinct e.trace_id) as traces,
            count(distinct e.user_id) as users,
            min(e.start_time) as first_seen,
            max(e.start_time) as last_seen,
            array_agg(distinct trim(coalesce(e.method, '') || ' ' || coalesce(e.route, ''))) as routes,
            array_agg(distinct e.application) as applications,
            (array_agg(e.trace_id order by (t.payload is not null) desc, e.start_time desc))[1] as sample_trace_id,
            array_agg(least(${ERROR_SLOTS - 1}, greatest(0, floor((extract(epoch from e.start_time) * 1000 - $${slotParam}) / $${slotParam + 1})))::int) as slots
     from error_events e join traces t on t.id = e.trace_id
     ${where.sql}
     group by e.error_id
     order by count desc`,
    [...where.params, from, (to - from) / ERROR_SLOTS],
  );
  const groups = rows.map((r): ErrorGroup => {
    const series = Array<number>(ERROR_SLOTS).fill(0);
    for (const s of r.slots as number[]) series[s]++;
    const status = (r.status as number | null) ?? undefined;
    return {
      key: String(r.error_id),
      id: String(r.error_id),
      status,
      severity: status && status >= 400 && status < 500 ? 'warning' : 'error',
      name: String(r.name),
      message: String(r.message),
      spanName: String(r.span_name),
      kind: r.span_kind as SpanKind,
      count: Number(r.count),
      traces: Number(r.traces),
      users: Number(r.users),
      firstSeen: ms(r.first_seen as Date),
      lastSeen: ms(r.last_seen as Date),
      routes: r.routes as string[],
      applications: r.applications as string[],
      sampleTraceId: String(r.sample_trace_id),
      series,
    };
  });
  return { groups, from, to };
}

/** Occurrences of one error group since `from`, ignoring filters (used for incident tracking). */
export async function errorEvents(errorId: string, from: number): Promise<{ count: number; lastSeen: number; lastTraceId?: string }> {
  const db = await getDb();
  const [r] = await db.query<{ count: string; last_seen: Date | null; last_trace_id: string | null }>(
    `select count(*) as count, max(e.start_time) as last_seen,
            (array_agg(e.trace_id order by (t.payload is not null) desc, e.start_time desc))[1] as last_trace_id
     from error_events e join traces t on t.id = e.trace_id
     where e.error_id = $1 and e.start_time >= to_timestamp($2)`,
    [errorId, from / 1000],
  );
  return { count: Number(r.count), lastSeen: r.last_seen ? ms(r.last_seen) : 0, lastTraceId: r.last_trace_id ?? undefined };
}

export async function errorIdsForTrace(traceId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.query<{ error_id: string }>('select distinct error_id from error_events where trace_id = $1', [traceId]);
  return rows.map((r) => r.error_id);
}

/* ------------------------------------------------------------------ */
/* Hotspots                                                            */
/* ------------------------------------------------------------------ */

const HOTSPOT_SAMPLE = 2000;
const pct = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

/**
 * Per-function aggregates over the most recent call trees in range (up to 2000), computed from
 * the stored payloads so self time can be derived from the tree.
 */
export async function getHotspots(q: TraceQuery = {}): Promise<Hotspot[]> {
  const db = await getDb();
  const where = whereClause(q, { search: false });
  const rows = await db.query<{ payload: TraceRecord }>(
    `select t.payload from traces t ${where.sql} ${where.sql ? 'and' : 'where'} t.payload is not null
     order by t.start_time desc limit ${HOTSPOT_SAMPLE}`,
    where.params,
  );
  // durations: individual call samples for p95; sum/max include calls folded into collapsed spans
  const agg = new Map<string, Hotspot & { durations: number[]; sum: number; traceIds: Set<string> }>();
  const weak = (x?: string) => !x || /^(null|undefined|unknown(\[\])?)$/.test(x);
  for (const { payload: t } of rows) {
    const self = selfTimes(t.spans);
    for (const sp of t.spans) {
      if (sp.parentId === null) continue;
      let h = agg.get(sp.name);
      if (!h) {
        h = {
          name: sp.name,
          kind: sp.kind,
          calls: 0,
          errors: 0,
          avg: 0,
          p95: 0,
          max: 0,
          totalSelf: 0,
          traces: 0,
          params: sp.params,
          async: sp.async,
          lastTraceId: t.id,
          durations: [],
          sum: 0,
          traceIds: new Set(),
        };
        agg.set(sp.name, h);
      }
      const n = callCount(sp);
      h.calls += n;
      h.sum += busyTime(sp);
      if (sp.collapsed) {
        h.errors += sp.collapsed.errors;
        // stand-ins for the folded calls: their average for p95, and the slowest one for max
        h.durations.push(sp.collapsed.totalDuration / Math.max(1, n), sp.collapsed.maxDuration);
      } else {
        if (sp.status === 'error') h.errors++;
        h.durations.push(sp.duration);
      }
      h.totalSelf += self.get(sp.id) ?? 0;
      h.traceIds.add(t.id);
      // keep the most informative inferred types (a 404 call returning `null` shouldn't win)
      if (sp.argTypes && (!h.argTypes || sp.argTypes.join().length >= h.argTypes.join().length)) h.argTypes = sp.argTypes;
      if (!weak(sp.resultType) || weak(h.resultType)) h.resultType = sp.resultType ?? h.resultType;
      if (sp.async) h.async = true;
    }
  }
  const out = [...agg.values()].map(({ durations, traceIds, sum, ...rest }) => {
    const sorted = durations.sort((a, b) => a - b);
    return {
      ...rest,
      avg: sum / Math.max(1, rest.calls),
      p95: pct(sorted, 95),
      max: sorted[sorted.length - 1],
      traces: traceIds.size,
    };
  });
  const needle = q.search?.toLowerCase();
  return (needle ? out.filter((h) => h.name.toLowerCase().includes(needle)) : out).sort((a, b) => b.totalSelf - a.totalSelf);
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export async function storageInfo() {
  const db = await getDb();
  const [r] = await db.query<Record<string, string | Date | null>>(
    `select count(*) filter (where payload is not null and not has_error) as healthy,
            count(*) filter (where payload is not null and has_error) as with_errors,
            count(*) as summaries,
            min(start_time) as oldest,
            pg_total_relation_size('traces') + pg_total_relation_size('error_events') as bytes
     from traces`,
  );
  return {
    database: { kind: db.kind, location: db.location },
    traces: Number(r.healthy) + Number(r.with_errors),
    errorTraces: Number(r.with_errors),
    summaries: Number(r.summaries),
    oldest: r.oldest ? ms(r.oldest as Date) : undefined,
    bytes: Number(r.bytes),
  };
}
