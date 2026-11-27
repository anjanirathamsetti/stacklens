import { withAuth } from '../../../auth/guard';
import { audit, listApiKeys, revokeApiKey } from '../../../repositories/account-repository';

/** Revoke a key. Apps using it are rejected from the next batch on. */
export const DELETE = withAuth<{ params: Promise<{ id: string }> }>('admin', async (_req, { params, user }) => {
  const { id } = await params;
  const key = (await listApiKeys()).find((k) => k.id === id);
  if (!key || !(await revokeApiKey(id))) return Response.json({ error: 'not found or already revoked' }, { status: 404 });
  await audit(user, 'api_key.revoked', key.name, { prefix: key.prefix });
  return new Response(null, { status: 204 });
});
