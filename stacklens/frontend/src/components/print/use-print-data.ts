'use client';
import { useEffect, useState } from 'react';

/**
 * Loads every URL once for a print report. Uses the same `/api/*` endpoints as the on-screen
 * pages, so an export passes the same auth and role checks and holds only data the user can see.
 * `fetchedAt` is the "Generated" time printed on the PDF.
 */
export function usePrintData<T extends Record<string, unknown>>(urls: { [K in keyof T]: string | null }): {
  data?: T;
  error?: string;
  fetchedAt?: number;
} {
  const key = JSON.stringify(urls);
  const [state, setState] = useState<{ key: string; data?: T; error?: string; fetchedAt?: number }>({ key });

  useEffect(() => {
    let cancelled = false;
    const entries = Object.entries(JSON.parse(key) as Record<string, string | null>);
    Promise.all(
      entries.map(async ([name, url]) => {
        if (!url) return [name, undefined] as const;
        const r = await fetch(url, { cache: 'no-store' });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return [name, body] as const;
      }),
    )
      .then((pairs) => {
        if (!cancelled) setState({ key, data: Object.fromEntries(pairs) as T, fetchedAt: Date.now() });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ key, error: e.message, fetchedAt: Date.now() });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state.key === key ? state : {};
}
