import { knownRoutes } from '../../repositories/slo-repository';
import { withAuth } from '../../auth/guard';

export const GET = withAuth('viewer', async () => {
  return Response.json({ routes: await knownRoutes() });
});
