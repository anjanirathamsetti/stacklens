import { withAuth } from '@/server/auth/guard';
import { hashPassword } from '@/server/auth/password';
import { tempPassword } from '@/server/auth/temp-password';
import { audit, createUser, emailTaken, isRole, listUsers, validEmail } from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

export const GET = withAuth('admin', async () => Response.json({ users: await listUsers() }));

/**
 * Add a user. StackLens doesn't send email, so the response carries a one-time password for the
 * admin to hand over; the new user must change it at first sign-in.
 */
export const POST = withAuth('admin', async (req, { user: admin }) => {
  const body = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown; role?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) return Response.json({ error: 'Enter a name' }, { status: 400 });
  if (!validEmail(body?.email)) return Response.json({ error: 'Enter a valid email address' }, { status: 400 });
  if (!isRole(body?.role)) return Response.json({ error: 'Pick a role' }, { status: 400 });
  if (await emailTaken(body.email as string)) return Response.json({ error: 'A user with that email already exists' }, { status: 409 });
  const password = tempPassword();
  const user = await createUser({
    name,
    email: body.email as string,
    role: body.role,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
  });
  await audit(admin, 'user.created', user.email, { role: user.role });
  return Response.json({ user, tempPassword: password }, { status: 201 });
});
