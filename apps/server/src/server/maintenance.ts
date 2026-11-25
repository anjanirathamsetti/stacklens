import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Incident, TraceRecord, TraceSummary } from '@/lib/api-types';
import type { Db } from './db/client';
import { env } from './env';
import { insertIncidentRows } from './repositories/incident-repository';
import { insertTraces } from './repositories/trace-repository';
import { summarize } from './trace-summary';

const RETENTION_LOCK = 7_041_913;
const g = globalThis as unknown as { __stacklensMaintenance?: NodeJS.Timeout };

/** Start the retention job (every minute) and the one-time legacy import. Idempotent. */
export function startMaintenance(db: Db): void {
  if (g.__stacklensMaintenance) return;
  const run = () => applyRetention(db).catch((e) => console.warn('[stacklens] retention failed:', (e as Error).message));
  g.__stacklensMaintenance = setInterval(run, 60_000);
  g.__stacklensMaintenance.unref?.();
  setTimeout(run, 5_000).unref?.();
  importLegacyJson(db).catch((e) => console.warn('[stacklens] legacy import failed:', (e as Error).message));
}

/**
 * Keep the newest N healthy call trees and M call trees with errors (older ones keep their summary
 * but lose the payload), and drop summaries past the retention window or the summary cap.
 * Guarded by an advisory lock so only one replica prunes at a time.
 */
export async function applyRetention(db: Db): Promise<void> {
  const [{ locked }] = await db.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [RETENTION_LOCK]);
  if (!locked) return;
  try {
    for (const [hasError, keep] of [
      [false, env.maxTraces],
      [true, env.maxErrorTraces],
    ] as const) {
      await db.query(
        `update traces set payload = null
         where id in (select id from traces where payload is not null and has_error = $1 order by start_time desc offset $2)`,
        [hasError, keep],
      );
    }
    await db.query(`delete from traces where start_time < now() - make_interval(days => $1)`, [env.retentionDays]);
    await db.query(`delete from traces where id in (select id from traces order by start_time desc offset $1)`, [env.maxSummaries]);
  } finally {
    await db.query('select pg_advisory_unlock($1)', [RETENTION_LOCK]);
  }
}

/**
 * Before PostgreSQL, StackLens kept data in JSON files in the data folder. Import them once,
 * then rename the files to `*.imported.json`.
 */
export async function importLegacyJson(db: Db): Promise<void> {
  const [done] = await db.query('select 1 from stacklens_meta where key = $1', ['legacy_json_import']);
  if (done) return;
  const file = (name: string) => path.join(env.dataDir, name);
  const read = <T>(name: string): T | undefined => {
    try {
      return JSON.parse(fs.readFileSync(file(name), 'utf8')) as T;
    } catch {
      return undefined;
    }
  };
  // Runs once (guarded by stacklens_meta). Live ingest may already be writing; inserts are idempotent on id.
  const summaries = read<TraceSummary[]>('summaries.json');
  const traces = read<TraceRecord[]>('traces.json');
  const incidents = read<{ incidents: Incident[] }>('incidents.json')?.incidents;

  if (summaries?.length || traces?.length || incidents?.length) {
    const started = Date.now();
    const full = new Map((traces ?? []).map((t) => [t.id, t]));
    const records = (summaries ?? []).map((s) => ({
      summary: { ...s, errors: s.errors ?? [], kindTime: s.kindTime ?? {} },
      payload: full.get(s.id) ?? null,
    }));
    const seen = new Set(records.map((r) => r.summary.id));
    for (const t of full.values()) if (!seen.has(t.id)) records.push({ summary: summarize(t), payload: t });
    for (let i = 0; i < records.length; i += 1000) await insertTraces(records.slice(i, i + 1000), db);
    if (incidents?.length) await insertIncidentRows(db, incidents);
    for (const name of ['summaries.json', 'traces.json', 'incidents.json']) {
      if (fs.existsSync(file(name))) fs.renameSync(file(name), file(name.replace('.json', '.imported.json')));
    }
    console.log(
      `[stacklens] imported ${records.length} traces and ${incidents?.length ?? 0} incidents from JSON in ${Date.now() - started}ms`,
    );
  }
  await db.query(`insert into stacklens_meta (key, value) values ($1, $2) on conflict (key) do nothing`, [
    'legacy_json_import',
    JSON.stringify({ at: new Date().toISOString() }),
  ]);
}
