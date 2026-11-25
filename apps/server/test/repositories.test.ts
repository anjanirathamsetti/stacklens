import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEmbedded, createPostgres, setDbForTesting, type Db } from '@/server/db/client';
import { migrate } from '@/server/db/migrations';
import { env } from '@/server/env';
import { applyRetention, importLegacyJson } from '@/server/maintenance';
import {
  getLocalIncident,
  insertIncidentRows,
  listLocalIncidents,
  nextIncidentNumber,
  saveLocalIncident,
} from '@/server/repositories/incident-repository';
import { getUserSettings, saveUserSettings } from '@/server/repositories/settings-repository';
import {
  errorEvents,
  errorIdsForTrace,
  getErrorGroups,
  getFacets,
  getHotspots,
  getMetrics,
  getTrace,
  ingestTraces,
  pageTraces,
  storageInfo,
  TRACES_CHANNEL,
} from '@/server/repositories/trace-repository';
import { makeTrace } from './fixtures';

/** What survives a JSON round-trip (jsonb drops `undefined` fields). */
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * The same suite runs against:
 *  - embedded PostgreSQL (PGlite, in memory) – the zero-config local mode
 *  - the `pg` driver over the PostgreSQL wire protocol – the production code path
 *    (PGlite behind pglite-socket stands in for a PostgreSQL server)
 */
const backends: { name: string; notify: boolean; setup: () => Promise<{ db: Db; teardown: () => Promise<void> }> }[] = [
  {
    name: 'embedded (PGlite)',
    notify: true,
    setup: async () => {
      const db = await createEmbedded();
      return { db, teardown: () => db.close() };
    },
  },
  {
    name: 'postgres wire protocol (pg driver)',
    // pglite-socket multiplexes every connection onto one PGlite session and only relays query
    // responses, so async NOTIFY messages never reach the LISTEN connection. Real PostgreSQL does.
    notify: false,
    setup: async () => {
      const pglite = await PGlite.create();
      const port = 20_000 + Math.floor(Math.random() * 20_000);
      const server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 10 });
      await server.start();
      const db = await createPostgres(`postgres://postgres@127.0.0.1:${port}/postgres`);
      return {
        db,
        teardown: async () => {
          await db.close();
          await server.stop();
          await pglite.close();
        },
      };
    },
  },
  // CI (and anyone with a server) also runs the suite against real PostgreSQL, NOTIFY included.
  ...(process.env.TEST_DATABASE_URL
    ? [
        {
          name: 'real PostgreSQL (TEST_DATABASE_URL)',
          notify: true,
          setup: async () => {
            const db = await createPostgres(process.env.TEST_DATABASE_URL!);
            return { db, teardown: () => db.close() };
          },
        },
      ]
    : []),
];

describe.each(backends)('$name', ({ setup, notify }) => {
  let db: Db;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    ({ db, teardown } = await setup());
    await migrate(db);
    await migrate(db); // idempotent
    setDbForTesting(db);
  });
  afterAll(async () => {
    setDbForTesting(undefined);
    await teardown();
  });
  beforeEach(async () => {
    setDbForTesting(db);
    await db.exec('truncate traces, incidents, user_settings, stacklens_meta cascade');
  });

  describe('traces', () => {
    it('ingests idempotently and round-trips the full call tree', async () => {
      const t = makeTrace({ userId: 'u_1' });
      expect(await ingestTraces([t, t])).toBe(1);
      expect(await ingestTraces([t])).toBe(0);
      expect(await getTrace(t.id)).toEqual(json(t));
    });

    it('filters, searches, sorts and paginates', async () => {
      const now = Date.now();
      await ingestTraces([
        makeTrace({ app: 'orders-api', duration: 50, startTime: now - 3000, userId: 'u_1001' }),
        makeTrace({ app: 'orders-api', duration: 10, startTime: now - 2000, status: 500, error: { name: 'Error', message: 'boom' } }),
        makeTrace({ app: 'billing-api', project: 'payments', duration: 30, startTime: now - 1000, route: '/orders' }),
      ]);
      expect((await pageTraces({})).total).toBe(3);
      expect((await pageTraces({ application: 'billing-api' })).traces.map((t) => t.route)).toEqual(['/orders']);
      expect((await pageTraces({ status: '5xx' })).traces).toHaveLength(1);
      expect((await pageTraces({ status: 'error' })).traces[0].errorCount).toBe(1);
      expect((await pageTraces({ userId: '1001' })).traces).toHaveLength(1);
      expect((await pageTraces({ search: 'UserRepository.findById' })).total).toBe(3); // matches span names
      expect((await pageTraces({ sort: 'duration', order: 'asc' })).traces.map((t) => t.duration)).toEqual([10, 30, 50]);
      const page2 = await pageTraces({ limit: 2, offset: 2 });
      expect(page2).toMatchObject({ total: 3 });
      expect(page2.traces).toHaveLength(1);
      expect((await pageTraces({ limit: 2, offset: 10 })).total).toBe(3); // count survives an empty page
      expect(await getFacets()).toMatchObject({ projects: ['payments', 'storefront'], projectApps: { payments: ['billing-api'] } });
    });

    it('computes metrics in SQL', async () => {
      const now = Date.now();
      await ingestTraces([
        ...Array.from({ length: 8 }, (_, i) => makeTrace({ startTime: now - 60_000 + i * 1000, duration: 10 + i, userId: `u${i % 3}` })),
        makeTrace({ startTime: now - 30_000, status: 404, error: { name: 'NotFound', message: 'User 9 not found', status: 404 } }),
        makeTrace({ startTime: now - 20_000, status: 500, error: { name: 'Error', message: 'boom' } }),
      ]);
      const m = await getMetrics({ from: now - 3_600_000, to: now });
      expect(m.totals).toMatchObject({ total: 10, errors: 1, users: 3 });
      expect(m.totals.errorRate).toBeCloseTo(0.1);
      expect(m.series.reduce((a, b) => a + b.count, 0)).toBe(10);
      expect(m.statusCodes).toMatchObject({ '2xx': 8, '4xx': 1, '5xx': 1 });
      expect(m.layers.map((l) => l.kind)).toEqual(expect.arrayContaining(['controller', 'service', 'repository']));
      expect(m.routes[0]).toMatchObject({ route: '/users/:id', count: 10 });
      expect(m.previous.total).toBe(0);
    });

    it('groups errors by origin and normalized message', async () => {
      const now = Date.now();
      const a = makeTrace({
        startTime: now - 5000,
        status: 404,
        userId: 'u1',
        error: { name: 'NotFound', message: 'User 9 not found', status: 404 },
      });
      const b = makeTrace({
        startTime: now - 4000,
        status: 404,
        userId: 'u2',
        error: { name: 'NotFound', message: 'User 42 not found', status: 404 },
      });
      const c = makeTrace({ startTime: now - 3000, status: 500, error: { name: 'Error', message: 'boom' } });
      await ingestTraces([a, b, c]);
      const { groups } = await getErrorGroups({ from: now - 3_600_000, to: now });
      expect(groups).toHaveLength(2);
      const notFound = groups.find((g) => g.name === 'NotFound')!;
      expect(notFound).toMatchObject({
        count: 2,
        users: 2,
        severity: 'warning',
        status: 404,
        spanName: 'UserService.getProfile',
        sampleTraceId: b.id,
      });
      expect(notFound.series.reduce((x, y) => x + y, 0)).toBe(2);
      expect(groups.find((g) => g.name === 'Error')!.severity).toBe('error');
      expect(await errorIdsForTrace(a.id)).toEqual([notFound.id]);
      expect(await errorEvents(notFound.id, now - 4500)).toMatchObject({ count: 1, lastTraceId: b.id });
    });

    it('aggregates hotspots from call trees', async () => {
      await ingestTraces([makeTrace(), makeTrace()]);
      const hs = await getHotspots({});
      expect(hs.find((h) => h.name === 'UserRepository.findById')).toMatchObject({
        calls: 2,
        kind: 'repository',
        resultType: '{ id: number }',
      });
    });

    it('prunes payloads and summaries by retention limits', async () => {
      const now = Date.now();
      await ingestTraces([
        ...Array.from({ length: 8 }, (_, i) => makeTrace({ startTime: now - 10_000 + i })),
        ...Array.from({ length: 5 }, (_, i) => makeTrace({ startTime: now - 5_000 + i, status: 500, error: { name: 'E', message: 'x' } })),
        makeTrace({ startTime: now - (env.retentionDays + 1) * 86_400_000 }),
      ]);
      await applyRetention(db);
      const info = await storageInfo();
      expect(info.traces - info.errorTraces).toBe(env.maxTraces); // 5 healthy payloads kept
      expect(info.errorTraces).toBe(env.maxErrorTraces); // 3 error payloads kept
      expect(info.summaries).toBe(13); // the 31-day-old trace is gone, the rest keep their summary
      expect((await pageTraces({ limit: 500 })).traces.filter((t) => t.hasPayload)).toHaveLength(8);
    });

    it.runIf(notify)('notifies listeners when traces arrive (LISTEN/NOTIFY)', async () => {
      const got = new Promise<string>((resolve) => void db.listen(TRACES_CHANNEL, resolve));
      await new Promise((r) => setTimeout(r, 50));
      await ingestTraces([makeTrace(), makeTrace()]);
      expect(JSON.parse(await got)).toEqual({ count: 2 });
    });
  });

  describe('incidents (demo mode)', () => {
    it('numbers, stores and updates incidents', async () => {
      const { seq, number } = await nextIncidentNumber();
      expect(number).toBe(`INC${String(seq).padStart(7, '0')}`);
      const inc = {
        sysId: `demo-${seq}`,
        number,
        shortDescription: 'boom',
        state: 'New',
        stateCode: 1,
        priority: '2 - High',
        priorityCode: 2,
        urgency: 1,
        impact: 2,
        openedAt: Date.now(),
        updatedAt: Date.now(),
        errorId: 'abc123',
        correlationId: 'stacklens:abc123',
        workNotes: [{ at: 1, author: 'stacklens', text: 'created' }],
      };
      await saveLocalIncident(inc);
      await saveLocalIncident({
        ...inc,
        state: 'Resolved',
        stateCode: 6,
        resolvedAt: Date.now(),
        workNotes: [...inc.workNotes, { at: 2, author: 'you', text: 'fixed' }],
      });
      const stored = await getLocalIncident(inc.sysId);
      expect(stored).toMatchObject({ number, stateCode: 6, errorId: 'abc123' });
      expect(stored?.workNotes).toHaveLength(2);
      expect(await listLocalIncidents()).toHaveLength(1);
    });

    it('keeps the number sequence ahead of imported incidents', async () => {
      await insertIncidentRows(db, [
        {
          sysId: 'demo-20000',
          number: 'INC0020000',
          shortDescription: 'old',
          state: 'New',
          stateCode: 1,
          priority: 'P3',
          priorityCode: 3,
          urgency: 2,
          impact: 2,
          openedAt: 1,
          updatedAt: 1,
        },
      ]);
      expect((await nextIncidentNumber()).seq).toBeGreaterThan(20000);
    });
  });

  describe('user settings', () => {
    it('upserts per user key', async () => {
      expect(await getUserSettings('u')).toBeUndefined();
      await saveUserSettings('u', { timeFormat: '24h' });
      await saveUserSettings('u', { timeFormat: '12h', ui: { live: false } });
      expect(await getUserSettings('u')).toStrictEqual({ timeFormat: '12h', ui: { live: false } });
    });
  });

  describe('legacy JSON import', () => {
    it('imports once and renames the files', async () => {
      const dir = env.dataDir;
      fs.mkdirSync(dir, { recursive: true });
      const full = makeTrace({ status: 500, error: { name: 'Error', message: 'legacy' } });
      fs.writeFileSync(path.join(dir, 'traces.json'), JSON.stringify([full]));
      fs.writeFileSync(path.join(dir, 'summaries.json'), JSON.stringify([]));
      fs.writeFileSync(
        path.join(dir, 'incidents.json'),
        JSON.stringify({
          seq: 10001,
          incidents: [
            {
              sysId: 'demo-10001',
              number: 'INC0010001',
              shortDescription: 'x',
              state: 'New',
              stateCode: 1,
              priority: 'P2',
              priorityCode: 2,
              urgency: 1,
              impact: 2,
              openedAt: 1,
              updatedAt: 1,
            },
          ],
        }),
      );
      await ingestTraces([makeTrace()]); // live traffic arriving before the import must not block it
      await importLegacyJson(db);
      expect(await getTrace(full.id)).toEqual(json(full));
      expect((await getErrorGroups({ from: 0, to: Date.now() + 1000 })).groups).toHaveLength(1);
      expect(await getLocalIncident('demo-10001')).toBeDefined();
      expect(fs.existsSync(path.join(dir, 'traces.imported.json'))).toBe(true);
      await importLegacyJson(db); // second run is a no-op
      expect((await pageTraces({})).total).toBe(2);
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    });
  });
});
