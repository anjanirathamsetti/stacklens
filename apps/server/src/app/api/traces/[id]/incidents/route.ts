import { incidentsByErrorId, toRef } from '@/server/incident-service';
import { errorIdsForTrace } from '@/server/repositories/trace-repository';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
}
