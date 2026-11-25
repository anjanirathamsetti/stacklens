import { getHotspots } from '@/server/repositories/trace-repository';
import { parseQuery } from '@/server/parse-query';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return Response.json({ hotspots: await getHotspots(parseQuery(req.url)) });
}
