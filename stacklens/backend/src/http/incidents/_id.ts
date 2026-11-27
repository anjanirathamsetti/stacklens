import { getIncident, updateIncident, type IncidentAction } from '../../services/incident-service';
import { withAuth } from '../../auth/guard';

export const GET = withAuth('viewer', async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  try {
    const inc = await getIncident(id);
    return inc ? Response.json({ incident: inc }) : Response.json({ error: 'not found' }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
});

export const PATCH = withAuth<{ params: Promise<{ id: string }> }>('member', async (req, { params, user }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as IncidentAction | null;
  if (!body || !['note', 'start', 'resolve'].includes(body.action))
    return Response.json({ error: 'action must be note | start | resolve' }, { status: 400 });
  if (body.action === 'note' && !body.text?.trim()) return Response.json({ error: 'text is required' }, { status: 400 });
  try {
    const inc = await updateIncident(id, { ...body, author: user.name }); // author comes from the session, not the client
    return inc ? Response.json({ incident: inc }) : Response.json({ error: 'not found' }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
});
