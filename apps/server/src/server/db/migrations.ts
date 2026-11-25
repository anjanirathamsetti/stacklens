import 'server-only';
import type { Db } from './client';

/**
 * Versioned, forward-only schema migrations. Append new entries; never edit applied ones.
 * Applied under an advisory lock so several server replicas can start at once.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: /* sql */ `
      create table traces (
        id            text primary key,
        start_time    timestamptz not null,
        duration_ms   double precision not null,
        status        text not null,
        kind          text not null,
        name          text not null,
        application   text not null,
        project       text not null,
        environment   text,
        user_id       text,
        method        text,
        url           text,
        route         text,
        status_code   integer,
        span_count    integer not null,
        error_count   integer not null,
        max_depth     integer not null,
        truncated     boolean not null default false,
        kind_time     jsonb not null default '{}'::jsonb,   -- self time per layer (ms)
        errors        jsonb not null default '[]'::jsonb,   -- where errors originated
        payload       jsonb,                                 -- full call tree; null once pruned
        has_error     boolean generated always as (error_count > 0 or status = 'error' or coalesce(status_code, 0) >= 400) stored,
        received_at   timestamptz not null default now()
      );
      create index traces_start_idx         on traces (start_time desc);
      create index traces_app_start_idx     on traces (application, start_time desc);
      create index traces_project_start_idx on traces (project, start_time desc);
      create index traces_user_start_idx    on traces (user_id, start_time desc) where user_id is not null;
      create index traces_route_idx         on traces (route);
      create index traces_payload_idx       on traces (has_error, start_time desc) where payload is not null;

      -- one row per error origin, denormalized so error groups don't scan call trees
      create table error_events (
        trace_id    text not null references traces (id) on delete cascade,
        error_id    text not null,
        start_time  timestamptz not null,
        application text not null,
        span_name   text not null,
        span_kind   text not null,
        name        text not null,
        message     text not null,
        status      integer,
        user_id     text,
        method      text,
        route       text
      );
      create index error_events_group_idx on error_events (error_id, start_time desc);
      create index error_events_start_idx on error_events (start_time desc);
      create index error_events_trace_idx on error_events (trace_id);

      -- incidents created in demo mode (real ServiceNow incidents live in ServiceNow)
      create sequence incident_number_seq start 10001;
      create table incidents (
        sys_id            text primary key,
        number            text not null unique,
        short_description text not null,
        description       text,
        state             text not null,
        state_code        integer not null,
        priority          text not null,
        priority_code     integer not null,
        urgency           integer not null,
        impact            integer not null,
        assigned_to       text,
        assignment_group  text,
        opened_at         timestamptz not null,
        updated_at        timestamptz not null,
        resolved_at       timestamptz,
        correlation_id    text,
        error_id          text,
        work_notes        jsonb not null default '[]'::jsonb
      );
      create index incidents_error_idx on incidents (error_id);

      -- per-browser preferences (profile, thresholds, UI state)
      create table user_settings (
        user_key   text primary key,
        settings   jsonb not null,
        updated_at timestamptz not null default now()
      );

      -- one-shot jobs such as the legacy JSON import
      create table stacklens_meta (
        key   text primary key,
        value jsonb not null
      );
    `,
  },
];

const LOCK_ID = 7_041_912; // arbitrary, stable

export async function migrate(db: Db): Promise<void> {
  await db.exec(
    `create table if not exists stacklens_migrations (id integer primary key, name text not null, applied_at timestamptz not null default now())`,
  );
  await db.query('select pg_advisory_lock($1)', [LOCK_ID]);
  try {
    const applied = new Set((await db.query<{ id: number }>('select id from stacklens_migrations')).map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await db.transaction(async (tx) => {
        await tx.exec(m.sql);
        await tx.query('insert into stacklens_migrations (id, name) values ($1, $2)', [m.id, m.name]);
      });
      console.log(`[stacklens] applied migration ${m.id}: ${m.name}`);
    }
  } finally {
    await db.query('select pg_advisory_unlock($1)', [LOCK_ID]);
  }
}
