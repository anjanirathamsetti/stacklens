import { isCrossSiteWrite } from '@/server/auth/guard';
import { endSession, getCurrentUser } from '@/server/auth/session';
import { audit } from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (isCrossSiteWrite(req)) return Response.json({ error: 'cross-site request blocked' }, { status: 403 });
  const user = await getCurrentUser();
  await endSession();
  if (user) await audit(user, 'logout', user.email);
  return new Response(null, { status: 204 });
}
