import 'server-only';
import { CONFIG_DEFAULTS, mergeConfig, type ConfigKey, type ConfigOf } from '@stacklens/shared/config-defaults';
import { getDb } from '../db/client';

/** Team-wide configuration documents (digest, ai, mcp), stored as JSON in `app_config`. */

export const isConfigKey = (k: string): k is ConfigKey => k in CONFIG_DEFAULTS;

export async function getConfig<K extends ConfigKey>(key: K): Promise<ConfigOf<K>> {
  const db = await getDb();
  const [r] = await db.query<{ value: unknown }>('select value from app_config where key = $1', [key]);
  return mergeConfig(key, r?.value);
}

/** Fields the server maintains itself (delivery bookkeeping); never overwritten from the UI. */
const SERVER_FIELDS = ['lastSentAt', 'lastError', 'lastSentDay'];

/** Saves a full or partial document: fields not in `value` keep their stored value. */
export async function saveConfig<K extends ConfigKey>(key: K, value: unknown): Promise<ConfigOf<K>> {
  const current = (await getConfig(key)) as unknown as Record<string, unknown>;
  const patch = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const merged = mergeConfig(key, { ...current, ...patch }) as unknown as Record<string, unknown>;
  for (const f of SERVER_FIELDS) delete merged[f];
  const db = await getDb();
  const [r] = await db.query<{ value: unknown }>(
    `insert into app_config (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = app_config.value || excluded.value, updated_at = now()
     returning value`,
    [key, JSON.stringify(merged)],
  );
  return mergeConfig(key, r.value);
}

/** Shallow-merge `patch` into the stored document without touching other fields (used for delivery bookkeeping). */
export async function patchConfig(key: ConfigKey, patch: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into app_config (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = app_config.value || excluded.value, updated_at = now()`,
    [key, JSON.stringify(patch)],
  );
}
