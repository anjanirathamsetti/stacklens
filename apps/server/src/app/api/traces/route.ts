import { clearTraces, pageTraces } from '@/server/repositories/trace-repository';
import { parseQuery } from '@/server/parse-query';
import { withAuth } from '@/server/auth/guard';
import { audit } from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

export const GET = withAuth('viewer', async (req: Request) => {
  return Response.json(await pageTraces(parseQuery(req.url)));
});

export const DELETE = withAuth('admin', async (_req, { user }) => {
  await clearTraces();
  await audit(user, 'data.traces_cleared', 'traces');
  return Response.json({ ok: true });
});
