import { withAuth } from '../../auth/guard';
import { audit, createApiKey, listApiKeys } from '../../repositories/account-repository';

export const GET = withAuth('admin', async () => Response.json({ keys: await listApiKeys() }));

/** The full key is returned once; only its hash is stored. */
export const POST = withAuth('admin', async (req, { user }) => {
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) return Response.json({ error: 'Give the key a name, e.g. the app that uses it' }, { status: 400 });
  const { key, info } = await createApiKey(name, user.id);
  await audit(user, 'api_key.created', info.name, { prefix: info.prefix });
  return Response.json({ key, info }, { status: 201 });
});
