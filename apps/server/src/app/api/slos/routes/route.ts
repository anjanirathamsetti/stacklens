import { knownRoutes } from '@/server/repositories/slo-repository';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

export const GET = withAuth('viewer', async () => {
  return Response.json({ routes: await knownRoutes() });
});
