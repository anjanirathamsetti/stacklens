import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { SpanError, SpanKind, SpanRecord } from '@stacklens/shared/api-types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 10) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * "28/8/2025, 7:37:16 PM" (12h) or "28/8/2025, 19:37:16" (24h) – the log-style format used in tables.
 * Pass withMs for "…7:37:16.482 PM".
 */
export function formatDateTime(ts: number, fmt: '12h' | '24h' = '12h', withMs = false): string {
  const d = new Date(ts);
  const date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = withMs ? `.${String(d.getMilliseconds()).padStart(3, '0')}` : '';
  if (fmt === '24h') return `${date}, ${String(d.getHours()).padStart(2, '0')}:${mm}:${ss}${ms}`;
  const h = d.getHours() % 12 || 12;
  return `${date}, ${h}:${mm}:${ss}${ms} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export const KIND_META: Record<SpanKind, { label: string; dot: string; bar: string; text: string; soft: string }> = {
  http: {
    label: 'HTTP',
    dot: 'bg-zinc-500',
    bar: 'bg-zinc-400 dark:bg-zinc-500',
    text: 'text-zinc-600 dark:text-zinc-300',
    soft: 'bg-zinc-500/10',
  },
  controller: {
    label: 'Controller',
    dot: 'bg-violet-500',
    bar: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
    soft: 'bg-violet-500/10',
  },
  handler: {
    label: 'Handler',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    soft: 'bg-amber-500/10',
  },
  service: { label: 'Service', dot: 'bg-sky-500', bar: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', soft: 'bg-sky-500/10' },
  repository: {
    label: 'Repository',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    soft: 'bg-emerald-500/10',
  },
  db: { label: 'DB / SQL', dot: 'bg-teal-500', bar: 'bg-teal-500', text: 'text-teal-600 dark:text-teal-400', soft: 'bg-teal-500/10' },
  function: {
    label: 'Function',
    dot: 'bg-slate-400',
    bar: 'bg-slate-400',
    text: 'text-slate-600 dark:text-slate-300',
    soft: 'bg-slate-500/10',
  },
  job: { label: 'Job', dot: 'bg-pink-500', bar: 'bg-pink-500', text: 'text-pink-600 dark:text-pink-400', soft: 'bg-pink-500/10' },
};

/** Tinted badge colours (Bifrost-style: soft fill, matching border and text). */
export const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-sky-500/10 text-sky-700 border-sky-500/25 dark:text-sky-300',
  POST: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300',
  PUT: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
  PATCH: 'bg-violet-500/10 text-violet-700 border-violet-500/25 dark:text-violet-300',
  DELETE: 'bg-rose-500/10 text-rose-700 border-rose-500/25 dark:text-rose-300',
  JOB: 'bg-fuchsia-500/10 text-fuchsia-700 border-fuchsia-500/25 dark:text-fuchsia-300',
};

export function statusTone(code?: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (!code) return 'neutral';
  if (code >= 500) return 'error';
  if (code >= 400) return 'warning';
  return 'success';
}

/* ------------------------------------------------------------------ */
/* Error severity: 4xx = client error (amber), everything else = red   */
/* ------------------------------------------------------------------ */

export type Severity = 'error' | 'warning';

export function errorStatus(e?: SpanError): number | undefined {
  if (!e) return undefined;
  if (e.status) return e.status;
  const m = /\(status (\d{3})\)/.exec(e.message);
  return m ? Number(m[1]) : undefined;
}

export function severityOf(span: Pick<SpanRecord, 'status' | 'error' | 'attributes'>): Severity | null {
  if (span.status !== 'error') {
    const code = Number((span.attributes as any)?.statusCode ?? 0);
    if (code >= 500) return 'error';
    if (code >= 400) return 'warning';
    return null;
  }
  const st = errorStatus(span.error) ?? Number((span.attributes as any)?.statusCode ?? 0);
  return st >= 400 && st < 500 ? 'warning' : 'error';
}

export const SEVERITY: Record<
  Severity,
  { label: string; bar: string; track: string; soft: string; text: string; dot: string; border: string; accent: string }
> = {
  error: {
    label: 'Error',
    bar: 'bg-rose-400 dark:bg-rose-400/80',
    track: 'bg-rose-400/20',
    soft: 'bg-rose-500/[0.07]',
    text: 'text-rose-600 dark:text-rose-300',
    dot: 'bg-rose-400',
    border: 'border-rose-400/30',
    accent: 'bg-rose-400',
  },
  warning: {
    label: 'Client error',
    bar: 'bg-amber-400 dark:bg-amber-400/80',
    track: 'bg-amber-400/20',
    soft: 'bg-amber-500/[0.07]',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-400',
    border: 'border-amber-400/30',
    accent: 'bg-amber-400',
  },
};
