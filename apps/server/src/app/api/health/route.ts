import pkg from '../../../../package.json';
import { getDb } from '@/server/db/client';

export const dynamic = 'force-dynamic';

/** Liveness / readiness probe for Docker, Kubernetes and load balancers. 503 while the database is unreachable. */
export async function GET() {
  try {
    const db = await getDb();
    await db.query('select 1');
    return Response.json({ status: 'ok', version: pkg.version, uptimeSec: Math.round(process.uptime()), database: db.kind });
  } catch (e) {
    return Response.json({ status: 'error', version: pkg.version, error: (e as Error).message }, { status: 503 });
  }
}
