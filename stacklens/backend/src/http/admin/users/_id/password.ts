import { withAuth } from '../../../../auth/guard';
import { hashPassword } from '../../../../auth/password';
import { tempPassword } from '../../../../auth/temp-password';
import { audit, deleteUserSessions, getUser, setPassword } from '../../../../repositories/account-repository';

/** Reset a user's password to a one-time password and sign them out everywhere. */
export const POST = withAuth<{ params: Promise<{ id: string }> }>('admin', async (_req, { params, user: admin }) => {
  const { id } = await params;
  const target = await getUser(id);
  if (!target) return Response.json({ error: 'not found' }, { status: 404 });
  if (id === admin.id) return Response.json({ error: 'Change your own password in Settings → Profile' }, { status: 409 });
  const password = tempPassword();
  await setPassword(id, await hashPassword(password), true);
  await deleteUserSessions(id);
  await audit(admin, 'user.password_reset', target.email);
  return Response.json({ tempPassword: password });
});
