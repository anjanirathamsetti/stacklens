import { getErrorGroups } from '@/server/repositories/trace-repository';
import { incidentsByErrorId, toRef } from '@/server/incident-service';
import { parseQuery } from '@/server/parse-query';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const [res, links] = await Promise.all([getErrorGroups(parseQuery(req.url)), incidentsByErrorId()]);
  for (const g of res.groups) {
    const inc = links.get(g.id);
    if (inc) g.incident = toRef(inc);
  }
  return Response.json(res);
}
