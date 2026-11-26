import { createIncident, listIncidents, source } from '@/server/incident-service';
import { errorEvents, getErrorGroups } from '@/server/repositories/trace-repository';
import { parseQuery } from '@/server/parse-query';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

/** Incidents tagged by StackLens, enriched with live stats of the error group they track. */
export const GET = withAuth('viewer', async (req: Request) => {
  const { source: src, incidents } = await listIncidents();
  const q = parseQuery(req.url);
  const { groups } = await getErrorGroups({ ...q, from: q.from ?? Date.now() - 7 * 86_400_000 });
  const byId = new Map(groups.map((g) => [g.id, g]));
  const enriched = await Promise.all(
    incidents.map(async (i) => {
      const g = i.errorId ? byId.get(i.errorId) : undefined;
      const since = i.errorId ? await errorEvents(i.errorId, i.openedAt) : undefined;
      return {
        ...i,
        error: g
          ? {
              id: g.id,
              name: g.name,
              message: g.message,
              spanName: g.spanName,
              kind: g.kind,
              applications: g.applications,
              routes: g.routes,
              severity: g.severity,
              series: g.series,
            }
          : undefined,
        eventsSinceOpened: since?.count ?? 0,
        lastSeen: since?.lastSeen || undefined,
        lastTraceId: since?.lastTraceId,
      };
    }),
  );
  const tracked = new Set(incidents.filter((i) => i.errorId && i.stateCode < 6).map((i) => i.errorId));
  const untracked = groups.filter((g) => !tracked.has(g.id)).slice(0, 20);
  return Response.json({ source: src, incidents: enriched, untracked });
});

export const POST = withAuth('member', async (req: Request) => {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body?.errorId || !body?.shortDescription)
    return Response.json({ error: 'errorId and shortDescription are required' }, { status: 400 });
  try {
    const inc = await createIncident({
      errorId: String(body.errorId),
      shortDescription: String(body.shortDescription),
      description: String(body.description ?? ''),
      urgency: Number(body.urgency ?? 2),
      impact: Number(body.impact ?? 2),
      assignmentGroup: body.assignmentGroup ? String(body.assignmentGroup) : undefined,
    });
    return Response.json({ incident: inc, source: source() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
});
