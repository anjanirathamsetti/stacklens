import 'server-only';
import type { Digest, DigestConfig, DigestRoute } from '@/lib/api-types';
import { getDb } from '../db/client';
import { env } from '../env';
import { getConfig, patchConfig } from '../repositories/config-repository';
import { sloStatuses } from '../repositories/slo-repository';
import { getErrorGroups, getMetrics } from '../repositories/trace-repository';

/** The daily digest: what changed in a period compared with the one before it. */

const FAILED = `(status = 'error' or coalesce(status_code, 0) >= 500)`;
const MIN_REQUESTS = 5;

async function routeStats(from: number, to: number, project?: string): Promise<DigestRoute[]> {
  const db = await getDb();
  const range = to - from;
  const rows = await db.query<Record<string, string | number | null>>(
    `with cur as (
       select application, method, coalesce(route, name) as route, count(*) as count,
              count(*) filter (where ${FAILED}) as errors,
              percentile_cont(0.95) within group (order by duration_ms) as p95
       from traces where start_time >= to_timestamp($1) and start_time < to_timestamp($2) and ($4::text is null or project = $4)
       group by 1, 2, 3
     ), prev as (
       select application, method, coalesce(route, name) as route, count(*) as count,
              percentile_cont(0.95) within group (order by duration_ms) as p95
       from traces where start_time >= to_timestamp($3) and start_time < to_timestamp($1) and ($4::text is null or project = $4)
       group by 1, 2, 3
     )
     select cur.*, case when prev.count >= ${MIN_REQUESTS} then prev.p95 end as previous_p95
     from cur left join prev on prev.application = cur.application and prev.route = cur.route
                            and prev.method is not distinct from cur.method`,
    [from / 1000, to / 1000, (from - range) / 1000, project || null],
  );
  return rows.map((r) => ({
    application: String(r.application),
    method: (r.method as string | null) ?? undefined,
    route: String(r.route),
    count: Number(r.count),
    errors: Number(r.errors),
    p95: Number(r.p95),
    previousP95: r.previous_p95 === null ? undefined : Number(r.previous_p95),
  }));
}

export async function buildDigest(opts: { from?: number; to?: number; project?: string } = {}): Promise<Digest> {
  const to = opts.to ?? Date.now();
  const from = opts.from ?? to - 86_400_000;
  const project = opts.project || undefined;
  const db = await getDb();

  const [metrics, errors, routes, slos] = await Promise.all([
    getMetrics({ from, to, project }),
    getErrorGroups({ from, to, project }),
    routeStats(from, to, project),
    sloStatuses(to),
  ]);

  // "new" = never seen before this period, not just first seen inside it
  const ids = errors.groups.map((g) => g.id);
  const firstSeen = ids.length
    ? new Map(
        (
          await db.query<{ error_id: string; first: Date | string }>(
            'select error_id, min(start_time) as first from error_events where error_id = any($1) group by 1',
            [ids],
          )
        ).map((r) => [r.error_id, new Date(r.first).getTime()]),
      )
    : new Map<string, number>();
  const newErrors = errors.groups.filter((g) => (firstSeen.get(g.id) ?? g.firstSeen) >= from);

  const busy = routes.filter((r) => r.count >= MIN_REQUESTS);
  return {
    from,
    to,
    generatedAt: Date.now(),
    totals: metrics.totals,
    previous: metrics.previous,
    newErrors: newErrors.slice(0, 10),
    topErrors: errors.groups.slice(0, 5),
    slowestRoutes: [...busy].sort((a, b) => b.p95 - a.p95).slice(0, 5),
    regressions: busy
      .filter((r) => r.previousP95 !== undefined && r.p95 > r.previousP95 * 1.2 && r.p95 - r.previousP95 > 20)
      .sort((a, b) => b.p95 / b.previousP95! - a.p95 / a.previousP95!)
      .slice(0, 5),
    busiestRoutes: [...routes].sort((a, b) => b.count - a.count).slice(0, 5),
    slos,
  };
}

/* ------------------------------ delivery ------------------------------ */

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`;
const delta = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : ''}${(((cur - prev) / prev) * 100).toFixed(0)}%` : 'new');

/** Slack Block Kit message (also readable by most chat webhooks that accept `text`). */
export function slackMessage(d: Digest, baseUrl?: string): Record<string, unknown> {
  const link = (path: string) => (baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : undefined);
  const t = d.totals;
  const lines = [
    `*Requests* ${t.total.toLocaleString()} (${delta(t.total, d.previous.total)}) · *Error rate* ${pct(t.errorRate)} · *p95* ${fmtMs(t.p95)}`,
  ];
  const section = (title: string, items: string[]) =>
    items.length ? [{ type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${items.join('\n')}` } }] : [];
  const breached = d.slos.filter((s) => s.state === 'breached' || s.state === 'at-risk');
  const digestUrl = link('/digest');
  return {
    text: `StackLens daily digest: ${t.total} requests, ${pct(t.errorRate)} errors, p95 ${fmtMs(t.p95)}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'StackLens daily digest' } },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
      ...section(
        `New errors (${d.newErrors.length})`,
        d.newErrors.slice(0, 5).map((e) => `• \`${e.spanName}\` ${e.name}: ${e.message.slice(0, 120)} (${e.count}×)`),
      ),
      ...section(
        'Slower than the day before',
        d.regressions.map((r) => `• ${r.method ?? ''} \`${r.route}\` p95 ${fmtMs(r.previousP95!)} → ${fmtMs(r.p95)}`),
      ),
      ...section(
        'SLOs needing attention',
        breached.map(
          (s) => `• ${s.name}: ${s.state} (budget left ${pct(Math.max(0, Math.min(s.latency.budgetLeft, s.availability.budgetLeft)))})`,
        ),
      ),
      ...(digestUrl ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `<${digestUrl}|Open the digest in StackLens>` }] }] : []),
    ],
  };
}

export async function sendDigest(config?: DigestConfig): Promise<{ ok: boolean; error?: string }> {
  const cfg = config ?? (await getConfig('digest'));
  if (!/^https?:\/\//.test(cfg.webhookUrl)) return { ok: false, error: 'Set a webhook URL (http or https) first.' };
  const digest = await buildDigest({ project: cfg.project });
  const body = cfg.format === 'slack' ? slackMessage(digest, env.publicUrl) : digest;
  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`webhook answered HTTP ${res.status}`);
    await patchConfig('digest', { lastSentAt: Date.now(), lastError: null });
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message;
    await patchConfig('digest', { lastError: error });
    return { ok: false, error };
  }
}

function localParts(tz: string, at = new Date()): { day: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
    return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  } catch {
    return localParts('UTC', at);
  }
}

/**
 * Called every minute by the maintenance loop. Sends at most once per local day; the day is
 * claimed with a conditional UPDATE so only one replica sends.
 */
export async function maybeSendScheduledDigest(): Promise<void> {
  const cfg = await getConfig('digest');
  if (!cfg.enabled || !cfg.webhookUrl) return;
  const { day, hour } = localParts(cfg.timezone);
  if (hour !== cfg.hour) return;
  const db = await getDb();
  const claimed = await db.query(
    `update app_config set value = value || jsonb_build_object('lastSentDay', $1::text)
     where key = 'digest' and coalesce(value->>'lastSentDay', '') <> $1 returning key`,
    [day],
  );
  if (!claimed.length) return;
  const r = await sendDigest(cfg);
  // release the day so the next minute retries (only within the configured hour)
  if (!r.ok) await patchConfig('digest', { lastSentDay: null });
}
