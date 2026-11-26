import { env } from '@/server/env';
import { getErrorGroups } from '@/server/repositories/trace-repository';
import { priorityOf } from '@/server/incident-service';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

/** Suggested incident fields for an error group. */
export const GET = withAuth('member', async (req: Request) => {
  const url = new URL(req.url);
  const errorId = url.searchParams.get('errorId');
  const g = (await getErrorGroups({ from: Date.now() - 7 * 86_400_000 })).groups.find((x) => x.id === errorId);
  if (!g) return Response.json({ error: 'error group not found in the last 7 days' }, { status: 404 });
  const base = env.publicUrl ?? url.origin;
  const app = g.applications.join(', ');
  // 5xx affecting many users → higher urgency; client errors → low
  const urgency = g.severity === 'warning' ? 3 : g.users >= 5 || g.count >= 50 ? 1 : 2;
  const impact = g.severity === 'warning' ? 3 : g.applications.length > 1 || g.users >= 10 ? 1 : 2;
  const description = [
    `StackLens detected a recurring ${g.severity === 'warning' ? 'client error' : 'error'} in ${app}.`,
    '',
    `Error:       ${g.name}: ${g.message}`,
    `Thrown in:   ${g.spanName} (${g.kind})`,
    `Endpoints:   ${g.routes.join(', ')}`,
    `Occurrences: ${g.count} in the last 7 days, ${g.users} affected user(s)`,
    `First seen:  ${new Date(g.firstSeen).toISOString()}`,
    `Last seen:   ${new Date(g.lastSeen).toISOString()}`,
    '',
    `Latest trace: ${base}/traces/${g.sampleTraceId}`,
    `All occurrences: ${base}/errors`,
    '',
    `StackLens error group: ${g.id}`,
  ].join('\n');
  return Response.json({
    errorId: g.id,
    shortDescription: `[${app}] ${g.name}: ${g.message}`.slice(0, 160),
    description,
    urgency,
    impact,
    priority: priorityOf(urgency, impact),
    group: g,
  });
});
