'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Tiny shared fetch cache: every component using the same URL sees the same data, and
 * `invalidate(url)` refetches it everywhere (e.g. the sidebar updates when a view is saved).
 */

interface Entry {
  data?: unknown;
  error?: string;
  loading: boolean;
  promise?: Promise<void>;
}

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY: Entry = { loading: true };

function emit(url: string) {
  listeners.get(url)?.forEach((l) => l());
}

function load(url: string): Promise<void> {
  const cur = cache.get(url);
  if (cur?.promise) return cur.promise;
  const promise = fetch(url, { cache: 'no-store' })
    .then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
      cache.set(url, { data: body, loading: false });
    })
    .catch((e: Error) => {
      cache.set(url, { ...cache.get(url), error: e.message, loading: false, promise: undefined });
    })
    .finally(() => emit(url));
  cache.set(url, { ...(cur ?? {}), loading: !cur?.data, promise });
  return promise;
}

export function invalidate(url: string): Promise<void> {
  const cur = cache.get(url);
  if (cur) cache.set(url, { ...cur, promise: undefined });
  return load(url);
}

/** Replace the cached value without a request (optimistic updates). */
export function setCached<T>(url: string, data: T) {
  cache.set(url, { data, loading: false });
  emit(url);
}

export function useResource<T>(url: string | null): { data?: T; error?: string; loading: boolean; reload: () => Promise<void> } {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!url) return () => {};
      let set = listeners.get(url);
      if (!set) listeners.set(url, (set = new Set()));
      set.add(cb);
      return () => set!.delete(cb);
    },
    [url],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => (url ? (cache.get(url) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
  useEffect(() => {
    if (url && !cache.get(url)?.data) void load(url);
  }, [url]);
  const reload = useCallback(() => (url ? invalidate(url) : Promise.resolve()), [url]);
  return { data: entry.data as T | undefined, error: entry.error, loading: entry.loading, reload };
}

/** JSON request helper that throws the server's `error` message. */
export async function sendJson<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}
