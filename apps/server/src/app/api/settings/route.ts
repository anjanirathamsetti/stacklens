import { env } from '@/server/env';
import { storageInfo } from '@/server/repositories/trace-repository';
import { source } from '@/server/incident-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    storage: {
      ...(await storageInfo()),
      limits: { traces: env.maxTraces, errorTraces: env.maxErrorTraces, summaries: env.maxSummaries },
      retentionDays: env.retentionDays,
      dataDir: env.dataDir,
    },
    incidents: source(),
    collector: { endpoint: '/api/ingest' },
    env: {
      publicUrl: env.publicUrl ?? null,
    },
  });
}
