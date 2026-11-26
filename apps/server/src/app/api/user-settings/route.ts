import { withAuth } from '@/server/auth/guard';
import { getUserSettings, saveUserSettings } from '@/server/repositories/settings-repository';

export const dynamic = 'force-dynamic';

/** Personal preferences (theme, thresholds, UI state) of the signed-in user. */
const keyOf = (id: string) => `user:${id}`;

export const GET = withAuth('viewer', async (_req, { user }) => {
  const settings = await getUserSettings(keyOf(user.id));
  return Response.json({ settings: settings ?? null });
});

export const PUT = withAuth('viewer', async (req, { user }) => {
  const body = (await req.json().catch(() => null)) as { settings?: unknown } | null;
  if (!body || typeof body.settings !== 'object' || body.settings === null || Array.isArray(body.settings)) {
    return Response.json({ error: 'body must be { settings: object }' }, { status: 400 });
  }
  try {
    await saveUserSettings(keyOf(user.id), body.settings as Record<string, unknown>);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 413 });
  }
});
