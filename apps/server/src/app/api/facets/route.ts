import { getFacets } from '@/server/repositories/trace-repository';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

export const GET = withAuth('viewer', async () => {
  return Response.json(await getFacets());
});
