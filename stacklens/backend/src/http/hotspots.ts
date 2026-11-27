import { getHotspots } from '../repositories/trace-repository';
import { parseQuery } from '../domain/parse-query';
import { withAuth } from '../auth/guard';

export const GET = withAuth('viewer', async (req: Request) => {
  return Response.json({ hotspots: await getHotspots(parseQuery(req.url)) });
});
