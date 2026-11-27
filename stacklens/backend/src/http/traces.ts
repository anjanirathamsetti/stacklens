import { clearTraces, pageTraces } from '../repositories/trace-repository';
import { parseQuery } from '../domain/parse-query';
import { withAuth } from '../auth/guard';
import { audit } from '../repositories/account-repository';

export const GET = withAuth('viewer', async (req: Request) => {
  return Response.json(await pageTraces(parseQuery(req.url)));
});

export const DELETE = withAuth('admin', async (_req, { user }) => {
  await clearTraces();
  await audit(user, 'data.traces_cleared', 'traces');
  return Response.json({ ok: true });
});
