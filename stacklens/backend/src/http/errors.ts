import { getErrorGroups } from '../repositories/trace-repository';
import { incidentsByErrorId, toRef } from '../services/incident-service';
import { parseQuery } from '../domain/parse-query';
import { withAuth } from '../auth/guard';

export const GET = withAuth('viewer', async (req: Request) => {
  const [res, links] = await Promise.all([getErrorGroups(parseQuery(req.url)), incidentsByErrorId()]);
  for (const g of res.groups) {
    const inc = links.get(g.id);
    if (inc) g.incident = toRef(inc);
  }
  return Response.json(res);
});
