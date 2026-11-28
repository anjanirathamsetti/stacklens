'use client';
import { rangeFromParams, type TimeRange } from '@/lib/url-filters';

/**
 * Query helpers for the print routes (`/print/*`). An export carries the page's URL state plus
 * `at` – the moment the user clicked "Export PDF" – so a relative range ("Last 1 hour") covers
 * the same window the user was looking at, not a slightly later one.
 */

/** Most rows a single PDF table holds (the traces API also caps a page at 500). */
export const MAX_PRINT_ROWS = 500;

/** Query keys that only drive on-screen UI state and never go into an export URL. */
export const UI_ONLY_KEYS = ['trace', 'selected', 'span', 'print'] as const;

/** Fallback for links without `at`: the moment this tab loaded (stable across renders, so data URLs don't change). */
let loadedAt: number | undefined;

export function printWindow(sp: URLSearchParams): { range: TimeRange; from: number; to: number; at: number } {
  const atParam = Number(sp.get('at'));
  const at = Number.isSafeInteger(atParam) && atParam > 0 ? atParam : (loadedAt ??= Date.now());
  const range = rangeFromParams(sp);
  if (range.kind === 'absolute') return { range, from: range.from, to: range.to, at };
  return { range, from: at - range.ms, to: at, at };
}

/** API query string for the global filters (+ extra keys), resolved against `at`. */
export function printApiQuery(sp: URLSearchParams, extra: Record<string, string | number | undefined> = {}): string {
  const { from, to } = printWindow(sp);
  const p = new URLSearchParams({ from: String(from), to: String(to) });
  for (const k of ['project', 'app', 'env', 'user'] as const) {
    const v = sp.get(k);
    if (v) p.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export interface PrintFilter {
  label: string;
  value: string;
}

/** "27 Nov 2026, 14:05" – unambiguous on paper, independent of the 12h/24h UI setting. */
export function printDateTime(ts: number, withSeconds = false): string {
  return new Date(ts).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  });
}

/** "Nov 27, 19:13:46" – for table cells; the year is in the report header. */
export function printShortDateTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Time range + global filters as label/value pairs for the PDF header. */
export function globalFilters(sp: URLSearchParams): PrintFilter[] {
  const { range, from, to } = printWindow(sp);
  const window = `${printDateTime(from)} → ${printDateTime(to)}`;
  const out: PrintFilter[] = [{ label: 'Time range', value: range.kind === 'relative' ? `${range.label} · ${window}` : window }];
  const named: [string, string][] = [
    ['project', 'Project'],
    ['app', 'Application'],
    ['env', 'Environment'],
    ['user', 'User'],
  ];
  for (const [k, label] of named) {
    const v = sp.get(k);
    if (v) out.push({ label, value: v });
  }
  return out;
}

/** Validated `page`/`size` from the URL, matching the on-screen pagination. */
export function pageOf(sp: URLSearchParams, defaultSize = 50): { page: number; size: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(sp.get('page'))) || 1);
  const sizeParam = Number(sp.get('size'));
  const size = [25, 50, 100].includes(sizeParam) ? sizeParam : defaultSize;
  return { page, size, offset: (page - 1) * size };
}

/**
 * Rows for a client-side list: the page the user was on (`scope` unset) or the whole list up to
 * MAX_PRINT_ROWS (`scope=all`, the table's own export button). The note says which, for the PDF.
 */
export function sliceForPrint<T>(sp: URLSearchParams, items: T[], noun: string, defaultSize = 50): { rows: T[]; note: string } {
  const total = items.length;
  if (sp.get('scope') === 'all') {
    const rows = items.slice(0, MAX_PRINT_ROWS);
    return {
      rows,
      note:
        total > rows.length
          ? `First ${rows.length.toLocaleString()} of ${total.toLocaleString()} ${noun}. Narrow the filters to export the rest.`
          : `All ${total.toLocaleString()} ${noun}.`,
    };
  }
  const { size } = pageOf(sp, defaultSize);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pageOf(sp, defaultSize).page, pages);
  const start = (page - 1) * size;
  const rows = items.slice(start, start + size);
  return {
    rows,
    note: total
      ? `${noun[0].toUpperCase()}${noun.slice(1)} ${start + 1}–${start + rows.length} of ${total.toLocaleString()} (page ${page} of ${pages}, as shown on screen).`
      : `No ${noun}.`,
  };
}
