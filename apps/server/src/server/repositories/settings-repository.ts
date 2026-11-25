import 'server-only';
import { getDb } from '../db/client';

/** Per-browser preferences, keyed by the `stacklens_uid` cookie. Stored as JSON so the UI owns the shape. */

const MAX_BYTES = 32 * 1024;

export async function getUserSettings(userKey: string): Promise<Record<string, unknown> | undefined> {
  const db = await getDb();
  const [r] = await db.query<{ settings: Record<string, unknown> }>('select settings from user_settings where user_key = $1', [userKey]);
  return r?.settings;
}

export async function saveUserSettings(userKey: string, settings: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(settings);
  if (json.length > MAX_BYTES) throw new Error('settings too large');
  const db = await getDb();
  await db.query(
    `insert into user_settings (user_key, settings, updated_at) values ($1, $2::jsonb, now())
     on conflict (user_key) do update set settings = excluded.settings, updated_at = now()`,
    [userKey, json],
  );
}
