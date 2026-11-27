'use client';
import { useCallback, useEffect, useState } from 'react';
import { CONFIG_DEFAULTS, type ConfigKey, type ConfigOf } from '@stacklens/shared/config-defaults';
import { sendJson, setCached, useResource } from '@/lib/use-resource';

type Envelope<K extends ConfigKey> = { config: ConfigOf<K> } & Record<string, unknown>;

/** Read-only access to a team config document (cached and shared across components). */
export function useConfigValue<K extends ConfigKey>(key: K) {
  const { data, loading } = useResource<Envelope<K>>(`/api/config/${key}`);
  return { config: data?.config ?? CONFIG_DEFAULTS[key], extras: (data ?? {}) as Record<string, unknown>, loading };
}

/** Editable draft of a config document with dirty tracking and save. */
export function useConfigDraft<K extends ConfigKey>(key: K) {
  const url = `/api/config/${key}`;
  const { data, loading } = useResource<Envelope<K>>(url);
  const [draft, setDraft] = useState<ConfigOf<K>>(CONFIG_DEFAULTS[key]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setDraft(data.config);
  }, [data]);

  const dirty = !!data && JSON.stringify(data.config) !== JSON.stringify(draft);
  const update = useCallback((patch: Partial<ConfigOf<K>> | ((c: ConfigOf<K>) => Partial<ConfigOf<K>>)) => {
    setDraft((c) => ({ ...c, ...(typeof patch === 'function' ? patch(c) : patch) }));
  }, []);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const r = await sendJson<Envelope<K>>(url, 'PUT', { config: draft });
      setCached(url, r);
    } finally {
      setSaving(false);
    }
  }, [url, draft]);
  const discard = useCallback(() => data && setDraft(data.config), [data]);

  return { draft, update, dirty, save, saving, discard, loading, extras: (data ?? {}) as Record<string, unknown> };
}
