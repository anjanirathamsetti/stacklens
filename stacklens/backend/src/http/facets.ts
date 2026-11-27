import { getFacets } from '../repositories/trace-repository';
import { withAuth } from '../auth/guard';

export const GET = withAuth('viewer', async () => {
  return Response.json(await getFacets());
});
