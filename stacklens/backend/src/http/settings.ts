import { env } from '../env';
import { storageInfo } from '../repositories/trace-repository';
import { source } from '../services/incident-service';
import { withAuth } from '../auth/guard';

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
