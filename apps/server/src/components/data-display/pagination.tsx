'use client';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { useFilters } from '@/lib/url-filters';
import { cn } from '@/lib/utils';

export const PAGE_SIZES = [25, 50, 100];

/** URL state minus paging/selection keys – changes to this reset the page to 1. */
export function filterKeyOf(sp: URLSearchParams | { toString(): string }) {
  const p = new URLSearchParams(sp.toString());
  for (const k of ['page', 'size', 'selected', 'trace']) p.delete(k);
  return p.toString();
}

/**
 * Page + page size kept in the URL (?page=2&size=50) so links, refreshes and back/forward
 * all land on the same place. Resets to page 1 whenever `resetKey` (the filters) changes.
 */
export function usePageState(resetKey: string, defaultSize = 50) {
  const { sp, set } = useFilters();
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const sizeParam = Number(sp.get('size'));
  const size = PAGE_SIZES.includes(sizeParam) ? sizeParam : defaultSize;

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (page !== 1) set({ page: '' });
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPage = useCallback((p: number) => set({ page: p <= 1 ? '' : p }), [set]);
  const setSize = useCallback((s: number) => set({ size: s === defaultSize ? '' : s, page: '' }), [set, defaultSize]);
  return { page, size, setPage, setSize, offset: (page - 1) * size };
}

/** Client-side slice for lists that are already fully loaded. */
export function usePaged<T>(items: T[], resetKey: string, defaultSize = 50) {
  const st = usePageState(resetKey, defaultSize);
  const pages = Math.max(1, Math.ceil(items.length / st.size));
  const page = Math.min(st.page, pages);
  const rows = useMemo(() => items.slice((page - 1) * st.size, page * st.size), [items, page, st.size]);
  return { ...st, page, rows, total: items.length };
}

function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

export function Pagination({
  page,
  size,
  total,
  onPage,
  onSize,
  noun = 'items',
  className,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (p: number) => void;
  onSize: (s: number) => void;
  noun?: string;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const btn =
    'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35';

  return (
    <div className={cn('flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-card px-3 py-2 text-xs', className)}>
      <div className="flex items-center gap-3 text-muted-foreground">
        <span>
          {total === 0 ? (
            `No ${noun}`
          ) : (
            <>
              <span className="font-medium text-foreground tabular-nums">
                {from.toLocaleString()}–{to.toLocaleString()}
              </span>{' '}
              of <span className="tabular-nums">{total.toLocaleString()}</span> {noun}
            </>
          )}
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          Rows
          <Select value={String(size)} onChange={(e) => onSize(Number(e.target.value))} className="h-7 w-[70px] text-xs" align="start">
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </span>
      </div>
      <nav className="flex items-center gap-0.5" aria-label="Pagination">
        <button className={btn} disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">
          <ChevronsLeft className="size-4" />
        </button>
        <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        {pageList(page, pages).map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="w-6 text-center text-muted-foreground">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={cn(
                'h-7 min-w-7 rounded-md px-1.5 font-mono tabular-nums transition-colors cursor-pointer',
                p === page ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
        <button className={btn} disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Last page">
          <ChevronsRight className="size-4" />
        </button>
      </nav>
    </div>
  );
}

/**
 * A list card that fills the remaining height: toolbar on top, a scrolling body with a sticky
 * table header, and the pagination bar pinned to the bottom. The body scrolls back to the top
 * whenever the page changes, so every page starts at a known place.
 */
export function TableShell({
  toolbar,
  notice,
  footer,
  children,
  scrollKey,
  className,
  minHeight = 420,
}: {
  toolbar?: React.ReactNode;
  /** pinned strip under the toolbar (e.g. "live updates paused") */
  notice?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** changes → scroll body to top (e.g. `${page}-${size}`) */
  scrollKey?: string;
  className?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [scrollKey]);
  return (
    <Card className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)} style={{ minHeight }}>
      {(toolbar || notice) && (
        <div className="shrink-0 border-b">
          {toolbar}
          {notice}
        </div>
      )}
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card [&_thead_tr]:shadow-[0_1px_0_var(--border)]"
      >
        {children}
      </div>
      {footer}
    </Card>
  );
}
