import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { getUserSettings, saveUserSettings } from '@/server/repositories/settings-repository';

export const dynamic = 'force-dynamic';

const COOKIE = 'stacklens_uid';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Anonymous per-browser key (StackLens has no accounts). */
async function userKey(): Promise<string> {
  const jar = await cookies();
  let key = jar.get(COOKIE)?.value;
  if (!key || !/^[0-9a-f-]{36}$/.test(key)) {
    key = randomUUID();
    jar.set(COOKIE, key, { httpOnly: true, sameSite: 'lax', maxAge: ONE_YEAR, path: '/' });
  }
  return key;
}

export async function GET() {
  const settings = await getUserSettings(await userKey());
  return Response.json({ settings: settings ?? null });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as { settings?: unknown } | null;
  if (!body || typeof body.settings !== 'object' || body.settings === null || Array.isArray(body.settings)) {
    return Response.json({ error: 'body must be { settings: object }' }, { status: 400 });
  }
  try {
    await saveUserSettings(await userKey(), body.settings as Record<string, unknown>);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 413 });
  }
}
