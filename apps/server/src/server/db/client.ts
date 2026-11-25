import 'server-only';
import path from 'node:path';
import { env } from '../env';

export type Tx = Pick<Db, 'query' | 'exec'>;

/** Minimal database surface used by the repositories – implemented by `pg` and embedded PGlite. */
export interface Db {
  readonly kind: 'postgres' | 'embedded';
  /** Human-readable location (DSN host/db with credentials removed, or the data folder). */
  readonly location: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run several statements (no parameters) – used by migrations. */
  exec(sql: string): Promise<void>;
  /** Run `fn` inside a transaction on a single connection. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Subscribe to `NOTIFY channel`. Returns an unsubscribe function. */
  listen(channel: string, onPayload: (payload: string) => void): Promise<() => void>;
  close(): Promise<void>;
}

/* ----------------------------- PostgreSQL (pg) ----------------------------- */

export async function createPostgres(url: string): Promise<Db> {
  const { Pool } = await import('pg');
  const ssl = env.database.ssl;
  const pool = new Pool({
    connectionString: url,
    max: env.database.poolMax,
    ssl: ssl === 'no-verify' ? { rejectUnauthorized: false } : ssl === 'true' || ssl === 'require' ? true : undefined,
    application_name: 'stacklens',
  });
  pool.on('error', (e) => console.error('[stacklens] postgres pool error', e.message));

  // One dedicated connection carries every LISTEN; notifications fan out in-process.
  const listeners = new Map<string, Set<(p: string) => void>>();
  let listenClient: import('pg').PoolClient | undefined;
  const ensureListenClient = async () => {
    if (listenClient) return listenClient;
    listenClient = await pool.connect();
    listenClient.on('notification', (n) => listeners.get(n.channel)?.forEach((cb) => cb(n.payload ?? '')));
    listenClient.on('error', () => {
      listenClient = undefined; // reconnects on the next listen()
    });
    return listenClient;
  };

  const u = new URL(url);
  return {
    kind: 'postgres',
    location: `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`,
    async query(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({
          query: async (sql, params) => (await client.query(sql, params as unknown[])).rows as never,
          exec: async (sql) => void (await client.query(sql)),
        });
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async listen(channel, cb) {
      const set = listeners.get(channel) ?? new Set();
      if (!listeners.has(channel)) {
        listeners.set(channel, set);
        await (await ensureListenClient()).query(`listen ${quoteIdent(channel)}`);
      }
      set.add(cb);
      return () => set.delete(cb);
    },
    async close() {
      listenClient?.release();
      await pool.end();
    },
  };
}

/* ------------------------- Embedded PostgreSQL (PGlite) ------------------------- */

export async function createEmbedded(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  return {
    kind: 'embedded',
    location: dataDir ?? 'memory',
    async query(sql, params) {
      return (await pg.query(sql, params as unknown[])).rows as never;
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async transaction(fn) {
      return pg.transaction((tx) =>
        fn({
          query: async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never,
          exec: async (sql) => void (await tx.exec(sql)),
        }),
      );
    },
    async listen(channel, cb) {
      return pg.listen(channel, cb);
    },
    async close() {
      await pg.close();
    },
  };
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/* --------------------------------- singleton --------------------------------- */

const g = globalThis as unknown as { __stacklensDb?: Promise<Db> };

/**
 * The process-wide database, connected and migrated on first use. Kept on `globalThis` so dev
 * hot-reloads reuse it (two embedded instances must never open the same folder).
 */
export function getDb(): Promise<Db> {
  g.__stacklensDb ??= (async () => {
    const db = env.database.url ? await createPostgres(env.database.url) : await createEmbedded(path.join(env.dataDir, 'pg'));
    const { migrate } = await import('./migrations');
    await migrate(db);
    console.log(`[stacklens] database ready (${db.kind}: ${db.location})`);
    const { startMaintenance } = await import('../maintenance');
    startMaintenance(db);
    return db;
  })().catch((e) => {
    g.__stacklensDb = undefined; // allow a retry on the next request
    throw e;
  });
  return g.__stacklensDb;
}

/** Test hook: use an explicit database (e.g. in-memory PGlite). */
export function setDbForTesting(db: Db | undefined): void {
  g.__stacklensDb = db ? Promise.resolve(db) : undefined;
}
