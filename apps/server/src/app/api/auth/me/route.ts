import { getCurrentUser } from '@/server/auth/session';
import { countUsers } from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

/** The signed-in user, or 401 with `setupRequired` when no account exists yet. */
export async function GET() {
  const user = await getCurrentUser();
  if (user) return Response.json({ user });
  return Response.json({ error: 'sign in required', setupRequired: (await countUsers()) === 0 }, { status: 401 });
}
