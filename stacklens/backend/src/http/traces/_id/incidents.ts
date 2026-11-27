import { incidentsByErrorId, toRef } from '../../../services/incident-service';
import { errorIdsForTrace } from '../../../repositories/trace-repository';
import { withAuth } from '../../../auth/guard';

export const GET = withAuth('viewer', async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const ids = await errorIdsForTrace(id);
  if (!ids.length) return Response.json({ incidents: [] });
  const map = await incidentsByErrorId();
  return Response.json({
    incidents: ids
      .map((e) => map.get(e))
      .filter(Boolean)
      .map((i) => toRef(i!)),
  });
});
