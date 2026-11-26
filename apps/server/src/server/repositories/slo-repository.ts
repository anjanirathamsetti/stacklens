import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Slo, SloInput, SloObjective, SloState, SloStatus } from '@/lib/api-types';
import { getDb } from '../db/client';

/**
 * Per-route service level objectives. Each SLO has two objectives over a rolling window:
 * latency (share of requests within `latencyMs`) and availability (share without a server error).
 */

interface SloRow {
  id: string;
  name: string;
  application: string;
  method: string | null;
  route: string;
  latency_ms: number;
  latency_target: number;
  availability_target: number;
  window_days: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const toSlo = (r: SloRow): Slo => ({
  id: r.id,
  name: r.name,
  application: r.application,
  method: r.method ?? undefined,
  route: r.route,
  latencyMs: Number(r.latency_ms),
  latencyTarget: Number(r.latency_target),
  availabilityTarget: Number(r.availability_target),
  windowDays: Number(r.window_days),
  createdAt: new Date(r.created_at).getTime(),
  updatedAt: new Date(r.updated_at).getTime(),
});

const FAILED = `(status = 'error' or coalesce(status_code, 0) >= 500)`;
const DAY = 86_400_000;

export function validateSlo(s: Partial<SloInput>): string | undefined {
  const frac = (v: unknown) => typeof v === 'number' && v > 0 && v < 1;
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80) return 'name is required (max 80 chars)';
  if (typeof s.application !== 'string' || !s.application) return 'application is required';
  if (typeof s.route !== 'string' || !s.route) return 'route is required';
  if (s.method !== undefined && s.method !== null && typeof s.method !== 'string') return 'method must be a string';
  if (typeof s.latencyMs !== 'number' || !(s.latencyMs > 0)) return 'latency threshold must be > 0 ms';
  if (!frac(s.latencyTarget)) return 'latency target must be between 0 and 100%';
  if (!frac(s.availabilityTarget)) return 'availability target must be between 0 and 100%';
  if (![1, 7, 14, 28, 30].includes(Number(s.windowDays))) return 'window must be 1, 7, 14, 28 or 30 days';
  return undefined;
}

export async function listSlos(): Promise<Slo[]> {
  const db = await getDb();
  return (await db.query<SloRow>('select * from slos order by lower(name)')).map(toSlo);
}

export async function createSlo(s: SloInput): Promise<Slo> {
  const db = await getDb();
  const [r] = await db.query<SloRow>(
    `insert into slos (id, name, application, method, route, latency_ms, latency_target, availability_target, window_days)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [
      randomUUID(),
      s.name.trim(),
      s.application,
      s.method || null,
      s.route,
      s.latencyMs,
      s.latencyTarget,
      s.availabilityTarget,
      s.windowDays,
    ],
  );
  return toSlo(r);
}

export async function updateSlo(id: string, s: SloInput): Promise<Slo | undefined> {
  const db = await getDb();
  const [r] = await db.query<SloRow>(
    `update slos set name = $2, application = $3, method = $4, route = $5, latency_ms = $6, latency_target = $7,
       availability_target = $8, window_days = $9, updated_at = now()
     where id = $1 returning *`,
    [id, s.name.trim(), s.application, s.method || null, s.route, s.latencyMs, s.latencyTarget, s.availabilityTarget, s.windowDays],
  );
  return r ? toSlo(r) : undefined;
}

export async function deleteSlo(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query('delete from slos where id = $1 returning id', [id])).length > 0;
}

function objective(target: number, total: number, bad: number, total1h: number, bad1h: number): SloObjective {
  const allowed = 1 - target;
  return {
    target,
    attained: total ? (total - bad) / total : 1,
    bad,
    budgetLeft: total ? 1 - bad / (total * allowed) : 1,
    burnRate1h: total1h ? bad1h / total1h / allowed : 0,
  };
}

function stateOf(total: number, objectives: SloObjective[]): SloState {
  if (!total) return 'no-data';
  if (objectives.some((o) => o.budgetLeft < 0)) return 'breached';
  if (objectives.some((o) => o.budgetLeft < 0.25 || o.burnRate1h > 2)) return 'at-risk';
  return 'healthy';
}

/** Attainment, error budget and burn rate of one SLO, evaluated at `now`. */
export async function sloStatus(slo: Slo, now = Date.now()): Promise<SloStatus> {
  const db = await getDb();
  const from = now - slo.windowDays * DAY;
  const params = [slo.application, slo.route, slo.method ?? null, from / 1000, now / 1000, slo.latencyMs, (now - 3_600_000) / 1000];
  const where = `where application = $1 and coalesce(route, name) = $2 and ($3::text is null or method = $3)
                 and start_time >= to_timestamp($4) and start_time <= to_timestamp($5)`;
  const [[agg], daily] = await Promise.all([
    db.query<Record<string, string | number | null>>(
      `select count(*) as total,
              count(*) filter (where duration_ms > $6) as slow,
              count(*) filter (where ${FAILED}) as failed,
              coalesce(percentile_cont(0.95) within group (order by duration_ms), 0) as p95,
              count(*) filter (where start_time >= to_timestamp($7)) as total_1h,
              count(*) filter (where start_time >= to_timestamp($7) and duration_ms > $6) as slow_1h,
              count(*) filter (where start_time >= to_timestamp($7) and ${FAILED}) as failed_1h
       from traces ${where}`,
      params,
    ),
    db.query<Record<string, string | number>>(
      `select (floor(extract(epoch from start_time) * 1000 / ${DAY}) * ${DAY})::bigint as day,
              count(*) as total,
              count(*) filter (where duration_ms <= $6) as fast,
              count(*) filter (where not ${FAILED}) as available
       from traces ${where} and $7::float8 is not null group by 1 order by 1`,
      params,
    ),
  ]);
  const total = Number(agg.total);
  const latency = objective(slo.latencyTarget, total, Number(agg.slow), Number(agg.total_1h), Number(agg.slow_1h));
  const availability = objective(slo.availabilityTarget, total, Number(agg.failed), Number(agg.total_1h), Number(agg.failed_1h));

  const byDay = new Map(daily.map((d) => [Number(d.day), d]));
  const firstDay = Math.floor(from / DAY) * DAY;
  const days = Array.from({ length: Math.ceil((now - firstDay) / DAY) }, (_, i) => {
    const day = firstDay + i * DAY;
    const d = byDay.get(day);
    return { day, total: Number(d?.total ?? 0), fast: Number(d?.fast ?? 0), available: Number(d?.available ?? 0) };
  });

  return { ...slo, state: stateOf(total, [latency, availability]), total, p95: Number(agg.p95), latency, availability, daily: days };
}

export async function sloStatuses(now = Date.now()): Promise<SloStatus[]> {
  return Promise.all((await listSlos()).map((s) => sloStatus(s, now)));
}

/** Routes seen in the last 7 days, for the SLO editor. */
export async function knownRoutes(): Promise<{ application: string; method?: string; route: string; count: number; p95: number }[]> {
  const db = await getDb();
  const rows = await db.query<Record<string, string | number | null>>(
    `select application, method, coalesce(route, name) as route, count(*) as count,
            percentile_cont(0.95) within group (order by duration_ms) as p95
     from traces where start_time > now() - interval '7 days'
     group by 1, 2, 3 order by 4 desc limit 300`,
  );
  return rows.map((r) => ({
    application: String(r.application),
    method: (r.method as string | null) ?? undefined,
    route: String(r.route),
    count: Number(r.count),
    p95: Number(r.p95),
  }));
}
