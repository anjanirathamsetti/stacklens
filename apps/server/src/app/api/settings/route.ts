import { env } from '@/server/env';
import { storageInfo } from '@/server/repositories/trace-repository';
import { source } from '@/server/incident-service';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

export const GET = withAuth('admin', async () => {
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
});
