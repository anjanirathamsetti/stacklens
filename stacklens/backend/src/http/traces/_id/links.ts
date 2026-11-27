import { getTraceLinks } from '../../../repositories/trace-repository';
import { withAuth } from '../../../auth/guard';

/** The caller and callees of a trace in other instrumented services (cross-service tracing). */
export const GET = withAuth('viewer', async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const links = await getTraceLinks(id);
  if (!links) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(links);
});
