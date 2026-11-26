import { withAuth } from '@/server/auth/guard';
import { listAudit } from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

export const GET = withAuth('admin', async (req) => {
  const sp = new URL(req.url).searchParams;
  const b = Number(sp.get('before'));
  const before = sp.get('before') && Number.isSafeInteger(b) ? b : undefined;
  return Response.json({ entries: await listAudit(Number(sp.get('limit')) || 100, before) });
});
