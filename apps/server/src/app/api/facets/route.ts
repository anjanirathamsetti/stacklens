import { getFacets } from '@/server/repositories/trace-repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await getFacets());
}
