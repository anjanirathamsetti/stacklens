import { hashPassword, passwordProblem, verifyPassword } from '../../auth/password';
import { rateLimit, withAuth } from '../../auth/guard';
import { currentToken } from '../../auth/session';
import { getConfig } from '../../repositories/config-repository';
import { audit, deleteUserSessions, getUserWithHash, setPassword } from '../../repositories/account-repository';

/** Change your own password. Signs out your other sessions. */
export const POST = withAuth(
  'viewer',
  async (req, { user }) => {
    if (rateLimit(`password:${user.id}`, 10, 15 * 60_000)) return Response.json({ error: 'Too many attempts' }, { status: 429 });
    const body = (await req.json().catch(() => null)) as { current?: unknown; next?: unknown } | null;
    const full = await getUserWithHash({ id: user.id });
    if (!full || typeof body?.current !== 'string' || !(await verifyPassword(body.current, full.passwordHash)))
      return Response.json({ error: 'Your current password is incorrect' }, { status: 400 });
    const { minPasswordLength } = await getConfig('security');
    const problem = passwordProblem(body.next, minPasswordLength);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    if (body.next === body.current) return Response.json({ error: 'Choose a password you haven’t used here' }, { status: 400 });
    await setPassword(user.id, await hashPassword(body.next as string), false);
    await deleteUserSessions(user.id, await currentToken());
    await audit(user, 'password.changed', user.email);
    return Response.json({ ok: true });
  },
  { allowPendingPassword: true },
);
