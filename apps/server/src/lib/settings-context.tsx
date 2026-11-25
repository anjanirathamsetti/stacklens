'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';

/**
 * Per-browser preferences: profile, KPI thresholds, defaults and UI state.
 *
 * Source of truth is the server (`user_settings` table via /api/user-settings, keyed by an
 * anonymous cookie). localStorage is only a cache so the first paint already uses the user's
 * preferences; changes are saved back to the server, debounced.
 */
export interface Settings {
  profile: { name: string; email: string; role: string };
  thresholds: {
    /** Error rate (fraction) at which the KPI turns amber / red. */
    errorWarn: number;
    errorBad: number;
    /** p95 latency (ms) at which the KPI turns amber / red. */
    p95Warn: number;
    p95Bad: number;
  };
  defaultRange: string;
  timeFormat: '24h' | '12h';
  ui: {
    sidebarCollapsed: boolean;
    live: boolean;
    theme: 'light' | 'dark' | 'system';
  };
}

export const DEFAULT_SETTINGS: Settings = {
  profile: { name: 'Local user', email: '', role: 'Developer' },
  thresholds: { errorWarn: 0.01, errorBad: 0.05, p95Warn: 300, p95Bad: 1000 },
  defaultRange: '1h',
  timeFormat: '12h',
  ui: { sidebarCollapsed: false, live: true, theme: 'system' },
};

const CACHE_KEY = 'stacklens.settings';
const SAVE_DELAY_MS = 600;

type Patch = Partial<Settings> | ((current: Settings) => Partial<Settings>);

function merge(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    profile: { ...DEFAULT_SETTINGS.profile, ...s.profile },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...s.thresholds },
    ui: { ...DEFAULT_SETTINGS.ui, ...s.ui },
  };
}

function readCache(): Settings | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? merge(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

const Ctx = createContext<{ settings: Settings; update: (patch: Patch) => void; reset: () => void; synced: boolean }>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
  reset: () => {},
  synced: false,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [synced, setSynced] = useState(false);
  const { theme, setTheme } = useTheme();
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 1) cached copy for the first paint, 2) server copy (wins), 3) upload a cache that predates the server copy
  useEffect(() => {
    const cached = readCache();
    if (cached) setSettings(cached);
    let cancelled = false;
    fetch('/api/user-settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(({ settings: server }: { settings: unknown }) => {
        if (cancelled) return;
        if (server) {
          const next = merge(server);
          setSettings(next);
          if (next.ui.theme) setTheme(next.ui.theme);
        } else if (cached) {
          dirty.current = true; // first visit since settings moved to the server
        }
        setSynced(true);
      })
      .catch(() => setSynced(true)); // offline / server error: keep working from the cache
    return () => {
      cancelled = true;
    };
  }, [setTheme]);

  // persist changes: cache immediately, server debounced
  useEffect(() => {
    if (!synced) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
    } catch {}
    if (!dirty.current) return;
    dirty.current = false;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/user-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings }),
      }).catch(() => {});
    }, SAVE_DELAY_MS);
  }, [settings, synced]);

  // theme changes made through next-themes (e.g. the sidebar) are part of the settings too
  useEffect(() => {
    if (!synced || !theme || theme === settings.ui.theme) return;
    dirty.current = true;
    setSettings((s) => ({ ...s, ui: { ...s.ui, theme: theme as Settings['ui']['theme'] } }));
  }, [theme, synced, settings.ui.theme]);

  const update = useCallback((patch: Patch) => {
    dirty.current = true;
    setSettings((s) => merge({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  }, []);

  const reset = useCallback(() => {
    dirty.current = true;
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return <Ctx.Provider value={{ settings, update, reset, synced }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);

/** Live auto-refresh toggle, stored with the user's settings. */
export function useLive(): { live: boolean; setLive: (v: boolean) => void } {
  const { settings, update } = useSettings();
  return { live: settings.ui.live, setLive: (live) => update((s) => ({ ui: { ...s.ui, live } })) };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
