import { buildDigest } from '../services/digest-service';
import { withAuth } from '../auth/guard';

export const GET = withAuth('viewer', async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  return Response.json(await buildDigest({ from: num('from'), to: num('to'), project: sp.get('project') ?? undefined }));
});
