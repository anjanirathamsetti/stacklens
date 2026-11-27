import pkg from '../../package.json';
import { getDb } from '../db/client';
import { route } from './request-context';

/** Liveness / readiness probe for Docker, Kubernetes and load balancers. 503 while the database is unreachable. */
async function handleGET() {
  try {
    const db = await getDb();
    await db.query('select 1');
    return Response.json({ status: 'ok', version: pkg.version, uptimeSec: Math.round(process.uptime()), database: db.kind });
  } catch (e) {
    console.warn('[stacklens] health check failed:', (e as Error).message);
    return Response.json({ status: 'error', version: pkg.version, database: 'unreachable' }, { status: 503 });
  }
}

export const GET = route(handleGET);
