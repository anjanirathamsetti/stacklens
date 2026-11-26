import { getHotspots } from '@/server/repositories/trace-repository';
import { parseQuery } from '@/server/parse-query';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

export const GET = withAuth('viewer', async (req: Request) => {
  return Response.json({ hotspots: await getHotspots(parseQuery(req.url)) });
});
