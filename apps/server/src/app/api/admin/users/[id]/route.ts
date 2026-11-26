import type { Role } from '@/lib/api-types';
import { withAuth } from '@/server/auth/guard';
import {
  audit,
  countActiveAdmins,
  deleteUser,
  deleteUserSessions,
  emailTaken,
  getUser,
  isRole,
  updateUser,
  validEmail,
} from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Change a user's name, email, role or disabled state. Keeps at least one active admin. */
export const PATCH = withAuth<Ctx>('admin', async (req, { params, user: admin }) => {
  const { id } = await params;
  const target = await getUser(id);
  if (!target) return Response.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown; role?: unknown; disabled?: unknown } | null;
  if (!body) return Response.json({ error: 'invalid JSON body' }, { status: 400 });

  const patch: { name?: string; email?: string; role?: Role; disabled?: boolean } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80)
      return Response.json({ error: 'Enter a name' }, { status: 400 });
    patch.name = body.name;
  }
  if (body.email !== undefined) {
    if (!validEmail(body.email)) return Response.json({ error: 'Enter a valid email address' }, { status: 400 });
    if (await emailTaken(body.email, id)) return Response.json({ error: 'A user with that email already exists' }, { status: 409 });
    patch.email = body.email;
  }
  if (body.role !== undefined) {
    if (!isRole(body.role)) return Response.json({ error: 'Unknown role' }, { status: 400 });
    patch.role = body.role;
  }
  if (body.disabled !== undefined) patch.disabled = !!body.disabled;

  const losesAdmin = target.role === 'admin' && !target.disabled && ((patch.role && patch.role !== 'admin') || patch.disabled);
  if (losesAdmin && (await countActiveAdmins(id)) === 0)
    return Response.json({ error: 'StackLens needs at least one active admin. Make someone else an admin first.' }, { status: 409 });
  if (id === admin.id && patch.disabled) return Response.json({ error: 'You can’t disable your own account' }, { status: 409 });

  const updated = await updateUser(id, patch);
  if (patch.disabled) await deleteUserSessions(id);
  await audit(admin, 'user.updated', target.email, {
    ...(patch.role && patch.role !== target.role ? { role: `${target.role} → ${patch.role}` } : {}),
    ...(patch.disabled !== undefined && patch.disabled !== target.disabled ? { disabled: patch.disabled } : {}),
    ...(patch.name && patch.name !== target.name ? { name: true } : {}),
    ...(patch.email && patch.email !== target.email ? { email: `${target.email} → ${patch.email}` } : {}),
  });
  return Response.json({ user: updated });
});

export const DELETE = withAuth<Ctx>('admin', async (_req, { params, user: admin }) => {
  const { id } = await params;
  const target = await getUser(id);
  if (!target) return Response.json({ error: 'not found' }, { status: 404 });
  if (id === admin.id) return Response.json({ error: 'You can’t delete your own account' }, { status: 409 });
  if (target.role === 'admin' && !target.disabled && (await countActiveAdmins(id)) === 0)
    return Response.json({ error: 'StackLens needs at least one active admin' }, { status: 409 });
  await deleteUser(id);
  await audit(admin, 'user.deleted', target.email, { role: target.role });
  return new Response(null, { status: 204 });
});
