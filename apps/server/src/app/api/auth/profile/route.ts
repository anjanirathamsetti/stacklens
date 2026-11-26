import { withAuth } from '@/server/auth/guard';
import { audit, emailTaken, updateUser, validEmail } from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

/** Update your own name and email. */
export const PATCH = withAuth('viewer', async (req, { user }) => {
  const body = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
  if (name !== undefined && (!name || name.length > 80)) return Response.json({ error: 'Enter your name' }, { status: 400 });
  const email = body?.email === undefined ? undefined : body.email;
  if (email !== undefined && !validEmail(email)) return Response.json({ error: 'Enter a valid email address' }, { status: 400 });
  if (email && (await emailTaken(email, user.id)))
    return Response.json({ error: 'That email is used by another account' }, { status: 409 });
  const updated = await updateUser(user.id, { name, email: email as string | undefined });
  await audit(user, 'profile.updated', user.email, { name: name !== undefined, email: email !== undefined });
  return Response.json({ user: updated });
});
