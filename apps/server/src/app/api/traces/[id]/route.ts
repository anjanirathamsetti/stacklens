import { getSummary, getTrace, pageTraces } from '@/server/repositories/trace-repository';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

export const GET = withAuth('viewer', async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const trace = await getTrace(id);
  if (!trace) {
    const summary = await getSummary(id);
    if (!summary) return Response.json({ error: 'not found' }, { status: 404 });
    // call tree was evicted – offer the newest trace of the same endpoint instead
    const newer = (
      await pageTraces({ application: summary.application, route: summary.route, method: summary.method, limit: 50 })
    ).traces.find((t) => t.hasPayload !== false && t.id !== id);
    const sameError = summary.errorCount
      ? (await pageTraces({ application: summary.application, route: summary.route, status: 'error', limit: 50 })).traces.find(
          (t) => t.hasPayload !== false && t.id !== id,
        )
      : undefined;
    return Response.json({ error: 'expired', summary, newerTraceId: sameError?.id ?? newer?.id }, { status: 410 });
  }
  return Response.json(trace);
});
