'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Query keys that are shared by every page (carried along in navigation). */
export const GLOBAL_KEYS = ['range', 'from', 'to', 'project', 'app', 'env', 'user'] as const;
export const DEFAULT_RANGE = '1h';

function preferredRange() {
  try {
    const s = JSON.parse(localStorage.getItem('stacklens.settings') ?? '{}');
    return typeof s.defaultRange === 'string' && parseRelative(s.defaultRange) ? s.defaultRange : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;
const UNIT_LABEL = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week' } as const;

export type TimeRange =
  | { kind: 'relative'; code: string; ms: number; label: string; short: string }
  | { kind: 'absolute'; from: number; to: number; label: string; short: string };

export function parseRelative(code: string): { ms: number; label: string; short: string } | null {
  const m = /^(\d+)([smhdw])$/.exec(code);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2] as keyof typeof UNIT_MS;
  return {
    ms: n * UNIT_MS[u],
    label: `Last ${n === 1 ? '' : n + ' '}${UNIT_LABEL[u]}${n === 1 ? '' : 's'}`,
    short: `${n}${u}`,
  };
}

export function fmtDateTime(ts: number, withYear = false) {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * The user's default range ("Default time range" in Settings) for URLs without `?range=`.
 * The server always renders the built-in default, so hydration renders it too and switches to the
 * saved preference right after (useSyncExternalStore's server snapshot) – no hydration mismatch.
 */
function usePreferredRange(): string {
  return useSyncExternalStore(subscribeStorage, preferredRange, () => DEFAULT_RANGE);
}
function subscribeStorage(cb: () => void) {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
}

/** `fallback` is the range used when the URL has none (defaults to the user's preference, client-side). */
export function rangeFromParams(sp: URLSearchParams, fallback?: string): TimeRange {
  const from = Number(sp.get('from'));
  const to = Number(sp.get('to'));
  if (sp.get('range') === 'abs' && from && to) {
    return { kind: 'absolute', from, to, label: `${fmtDateTime(from)} → ${fmtDateTime(to)}`, short: 'abs' };
  }
  const code = sp.get('range') || fallback || (typeof window !== 'undefined' ? preferredRange() : DEFAULT_RANGE);
  const rel = parseRelative(code) ?? parseRelative(DEFAULT_RANGE)!;
  return { kind: 'relative', code, ...rel };
}

export function resolveRange(r: TimeRange): { from: number; to: number } {
  if (r.kind === 'absolute') return { from: r.from, to: r.to };
  const to = Date.now();
  return { from: to - r.ms, to };
}

export function useFilters() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const spRef = useRef(sp);
  useLayoutEffect(() => {
    spRef.current = sp;
  });

  const preferred = usePreferredRange();
  const range = useMemo(() => rangeFromParams(new URLSearchParams(sp.toString()), preferred), [sp, preferred]);
  const values = {
    project: sp.get('project') ?? '',
    app: sp.get('app') ?? '',
    env: sp.get('env') ?? '',
    user: sp.get('user') ?? '',
  };

  const set = useCallback(
    (patch: Record<string, string | number | undefined | null>) => {
      const p = new URLSearchParams(spRef.current.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '') p.delete(k);
        else p.set(k, String(v));
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  /** Build an API query string (relative ranges resolved to absolute timestamps *now*). */
  const apiQuery = useCallback((extra: Record<string, string | number | undefined> = {}) => {
    const cur = new URLSearchParams(spRef.current.toString());
    const { from, to } = resolveRange(rangeFromParams(cur));
    const p = new URLSearchParams();
    p.set('from', String(from));
    p.set('to', String(to));
    for (const k of ['project', 'app', 'env', 'user'] as const) {
      const v = cur.get(k);
      if (v) p.set(k, v);
    }
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v));
    return p.toString();
  }, []);

  /** Query string with only the global keys – used to carry filters across pages. */
  const globalQs = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of GLOBAL_KEYS) {
      const v = sp.get(k);
      if (v) p.set(k, v);
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [sp]);

  const key = sp.toString();
  return { range, values, set, apiQuery, globalQs, sp, key };
}

/**
 * Re-run `fn` when new traces arrive (SSE, throttled) and, for relative ranges,
 * on an interval so the window keeps sliding.
 */
export function useLiveRefresh(fn: () => void, enabled: boolean, intervalMs = 10_000) {
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const wait = 3000 - (Date.now() - last);
      if (wait > 0) {
        if (!timer) timer = setTimeout(() => ((timer = undefined), (last = Date.now()), fnRef.current()), wait);
        return;
      }
      last = Date.now();
      fnRef.current();
    };
    const es = new EventSource('/api/stream');
    es.onmessage = run;
    const iv = setInterval(run, intervalMs);
    return () => {
      es.close();
      clearInterval(iv);
      clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}
