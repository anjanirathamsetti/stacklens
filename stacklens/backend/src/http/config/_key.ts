import type { AuthUser } from '@stacklens/shared/api-types';
import { withAuth } from '../../auth/guard';
import { hasRole } from '../../auth/session';
import { env } from '../../env';
import { audit } from '../../repositories/account-repository';
import { getConfig, isConfigKey, saveConfig } from '../../repositories/config-repository';

type Ctx = { params: Promise<{ key: string }> };

/** Facts the UI needs alongside a config document (never secrets). */
function extras(key: string, user: AuthUser) {
  const canEdit = hasRole(user, 'admin');
  if (key === 'ai') return { canEdit, apiKeySet: !!env.ai.apiKey, backendAvailable: false };
  if (key === 'mcp') return { canEdit, serverAvailable: false };
  if (key === 'digest') return { canEdit, publicUrl: env.publicUrl ?? null };
  return { canEdit };
}

/** Webhook URLs carry a secret; only admins see them. */
function forUser(key: string, config: Record<string, unknown>, user: AuthUser) {
  if (key === 'digest' && !hasRole(user, 'admin')) return { ...config, webhookUrl: config.webhookUrl ? '••••••••' : '' };
  return config;
}

/** Team-wide settings: everyone signed in can read them, only admins can change them. */
export const GET = withAuth<Ctx>('viewer', async (_req, { params, user }) => {
  const { key } = await params;
  if (!isConfigKey(key)) return Response.json({ error: 'unknown config' }, { status: 404 });
  const config = (await getConfig(key)) as unknown as Record<string, unknown>;
  return Response.json({ config: forUser(key, config, user), ...extras(key, user) });
});

export const PUT = withAuth<Ctx>('admin', async (req, { params, user }) => {
  const { key } = await params;
  if (!isConfigKey(key)) return Response.json({ error: 'unknown config' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { config?: unknown } | null;
  if (!body || typeof body.config !== 'object' || body.config === null || Array.isArray(body.config))
    return Response.json({ error: 'body must be { config: object }' }, { status: 400 });
  if (JSON.stringify(body.config).length > 16_384) return Response.json({ error: 'config too large' }, { status: 413 });
  if (key === 'security') {
    const s = body.config as Record<string, unknown>;
    if (s.sessionDays !== undefined && !(Number(s.sessionDays) >= 1 && Number(s.sessionDays) <= 90))
      return Response.json({ error: 'Session length must be 1–90 days' }, { status: 400 });
    if (s.minPasswordLength !== undefined && !(Number(s.minPasswordLength) >= 8 && Number(s.minPasswordLength) <= 64))
      return Response.json({ error: 'Minimum password length must be 8–64' }, { status: 400 });
  }
  const saved = (await saveConfig(key, body.config)) as unknown as Record<string, unknown>;
  await audit(user, `settings.${key}.updated`, key);
  return Response.json({ config: forUser(key, saved, user), ...extras(key, user) });
});
