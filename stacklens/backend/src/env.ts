import 'server-only';
import os from 'node:os';
import path from 'node:path';

/**
 * All server configuration, read once from the environment. Every other module imports `env`
 * instead of touching `process.env`, so the full set of knobs is documented in one place.
 */

function int(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    console.warn(`[stacklens] ignoring invalid ${name}=${raw}; using ${fallback}`);
    return fallback;
  }
  return n;
}

function str(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export const env = {
  /** Embedded database location (when DATABASE_URL is unset) and legacy JSON import source. Outside the project so dev reloads aren't triggered. */
  dataDir: str('STACKLENS_DATA_DIR') ?? path.join(os.homedir(), '.stacklens', 'data'),
  /** Healthy call trees kept in memory. */
  maxTraces: int('STACKLENS_MAX_TRACES', 3000),
  /** Extra budget for call trees that contain errors. */
  maxErrorTraces: int('STACKLENS_MAX_ERROR_TRACES', 2000),
  /** Lightweight request summaries kept for charts and long time ranges. */
  maxSummaries: int('STACKLENS_MAX_SUMMARIES', 100_000),
  /** Public base URL, used for links in incident descriptions. Falls back to the request origin. */
  publicUrl: str('STACKLENS_PUBLIC_URL'),
  /** Delete request summaries older than this many days. */
  retentionDays: int('STACKLENS_RETENTION_DAYS', 30),

  database: {
    /** `postgres://…` – use an external PostgreSQL server (production). Unset → embedded PostgreSQL in `dataDir`. */
    url: str('DATABASE_URL'),
    poolMax: int('STACKLENS_DB_POOL_MAX', 10),
    /** `true` / `require` → TLS; `no-verify` → TLS without certificate verification. */
    ssl: str('STACKLENS_DB_SSL'),
  },

  serviceNow: {
    instance: str('SERVICENOW_INSTANCE'),
    username: str('SERVICENOW_USERNAME'),
    password: str('SERVICENOW_PASSWORD'),
    token: str('SERVICENOW_TOKEN'),
    assignmentGroup: str('SERVICENOW_ASSIGNMENT_GROUP'),
    callerId: str('SERVICENOW_CALLER_ID'),
    category: str('SERVICENOW_CATEGORY') ?? 'software',
    closeCode: str('SERVICENOW_CLOSE_CODE') ?? 'Solution provided',
  },

  /**
   * Trust X-Forwarded-For / X-Real-IP for the client address (rate limits, audit log). Only enable
   * behind a reverse proxy that overwrites these headers – otherwise clients can spoof them.
   */
  trustProxy: str('STACKLENS_TRUST_PROXY') === '1' || str('STACKLENS_TRUST_PROXY') === 'true',

  /** Optional first admin, created at startup when no account exists (handy for Docker / CI). */
  bootstrapAdmin: {
    email: str('STACKLENS_ADMIN_EMAIL'),
    password: str('STACKLENS_ADMIN_PASSWORD'),
  },

  ai: {
    /** API key for the AI provider chosen in the UI. Kept server-side only; the UI only learns whether it is set. */
    apiKey: str('STACKLENS_AI_API_KEY'),
  },
} as const;
