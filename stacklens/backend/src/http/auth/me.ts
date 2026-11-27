import { getCurrentUser } from '../../auth/session';
import { countUsers } from '../../repositories/account-repository';
import { route } from '../request-context';

/** The signed-in user, or 401 with `setupRequired` when no account exists yet. */
async function handleGET() {
  const user = await getCurrentUser();
  if (user) return Response.json({ user });
  return Response.json({ error: 'sign in required', setupRequired: (await countUsers()) === 0 }, { status: 401 });
}

export const GET = route(handleGET);
