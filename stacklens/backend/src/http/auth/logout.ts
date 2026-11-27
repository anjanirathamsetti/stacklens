import { isCrossSiteWrite } from '../../auth/guard';
import { endSession, getCurrentUser } from '../../auth/session';
import { audit } from '../../repositories/account-repository';
import { route } from '../request-context';

async function handlePOST(req: Request) {
  if (isCrossSiteWrite(req)) return Response.json({ error: 'cross-site request blocked' }, { status: 403 });
  const user = await getCurrentUser();
  await endSession();
  if (user) await audit(user, 'logout', user.email);
  return new Response(null, { status: 204 });
}

export const POST = route(handlePOST);
