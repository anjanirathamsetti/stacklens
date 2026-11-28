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
  {
    id: 2,
    name: 'saved views, slos, app config',
    sql: /* sql */ `
      -- named filter presets shared by the whole team
      create table saved_views (
        id          text primary key,
        name        text not null,
        path        text not null,                  -- page, e.g. /traces
        query       text not null default '',       -- URL query string without the leading ?
        description text,
        pinned      boolean not null default false, -- shown in the sidebar
        created_by  text,
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      );
      create index saved_views_pinned_idx on saved_views (pinned, name);

      -- per-route service level objectives
      create table slos (
        id                  text primary key,
        name                text not null,
        application         text not null,
        method              text,                    -- null = any method
        route               text not null,
        latency_ms          double precision not null,
        latency_target      double precision not null, -- fraction of requests faster than latency_ms
        availability_target double precision not null, -- fraction of requests without a server error
        window_days         integer not null,
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now()
      );

      -- team-wide configuration documents (digest, ai, mcp)
      create table app_config (
        key        text primary key,
        value      jsonb not null,
        updated_at timestamptz not null default now()
      );
    `,
  },
  {
    id: 3,
    name: 'users, sessions, api keys, audit log',
    sql: /* sql */ `
      create table users (
        id             text primary key,
        email          text not null,
        name           text not null,
        role           text not null check (role in ('admin', 'member', 'viewer')),
        password_hash  text not null,
        disabled       boolean not null default false,
        must_change_password boolean not null default false,
        created_at     timestamptz not null default now(),
        updated_at     timestamptz not null default now(),
        last_login_at  timestamptz
      );
      create unique index users_email_idx on users (lower(email));

      -- only a SHA-256 of the session token is stored; the token itself lives in the cookie
      create table sessions (
        token_hash   text primary key,
        user_id      text not null references users (id) on delete cascade,
        created_at   timestamptz not null default now(),
        expires_at   timestamptz not null,
        last_seen_at timestamptz not null default now(),
        user_agent   text,
        ip           text
      );
      create index sessions_user_idx on sessions (user_id);
      create index sessions_expires_idx on sessions (expires_at);

      -- keys used by instrumented apps to send traces
      create table api_keys (
        id           text primary key,
        name         text not null,
        prefix       text not null,       -- first characters, shown in the UI to recognise a key
        key_hash     text not null unique,
        scope        text not null default 'ingest',
        created_by   text references users (id) on delete set null,
        created_at   timestamptz not null default now(),
        last_used_at timestamptz,
        revoked_at   timestamptz
      );

      create table audit_log (
        id          bigserial primary key,
        at          timestamptz not null default now(),
        actor_id    text,
        actor_email text,
        action      text not null,
        target      text,
        details     jsonb not null default '{}'::jsonb,
        ip          text
      );
      create index audit_log_at_idx on audit_log (at desc);
    `,
  },
  {
    id: 4,
    name: 'cross-service trace links',
    sql: /* sql */ `
      -- set when another instrumented service made the request (W3C traceparent); joined at read time,
      -- so parent and child may arrive in any order or live on different servers
      alter table traces add column if not exists parent_trace_id text;
      alter table traces add column if not exists parent_span_id  text;
      alter table traces add column if not exists parent_service  text;
      create index if not exists traces_parent_idx on traces (parent_trace_id, start_time) where parent_trace_id is not null;
    `,
  },
  {
    id: 5,
    name: 'outgoing call summary',
    sql: /* sql */ `
      -- outgoing HTTP calls made by the request (counting calls folded into collapsed spans) and their hosts
      alter table traces add column if not exists outbound_count integer not null default 0;
      alter table traces add column if not exists outbound_hosts jsonb not null default '[]'::jsonb;
      create index if not exists traces_outbound_idx on traces (start_time desc) where outbound_count > 0;
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
