'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTheme } from 'next-themes';
import { Activity, Bookmark, CornerDownLeft, LogOut, Moon, PanelLeft, Search, Sun, type LucideIcon } from 'lucide-react';
import { ACCOUNT_ITEMS, ADMIN_ITEMS, NAV_GROUPS, UNFILTERED } from '@/components/layout/nav-config';
import { PAGE_LABELS, describeQuery, useSavedViews } from '@/lib/saved-views';
import { signOut, useCan } from '@/lib/current-user';
import { useSettings } from '@/lib/settings-context';
import { useFilters } from '@/lib/url-filters';
import { cn } from '@/lib/utils';

/* ------------------------------ open state ------------------------------ */

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};
export const openCommandPalette = () => setOpen(true);
function useOpen() {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => open,
    () => false,
  );
}

/* --------------------------------- items -------------------------------- */

interface Item {
  id: string;
  section: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

const TRACE_ID = /^[0-9a-f]{16,40}$/i;

/** Every word of the query must appear in the label, hint or keywords. */
function matches(item: Item, q: string) {
  if (!q) return true;
  const hay = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''} ${item.section}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

/**
 * ⌘K / Ctrl+K search: jump to any page, saved view, admin section or trace id, and run a few
 * quick actions. Opened from the sidebar search box too.
 */
export function CommandPalette() {
  const isOpen = useOpen();
  const router = useRouter();
  const { globalQs } = useFilters();
  const { views } = useSavedViews();
  const isAdmin = useCan('admin');
  const { resolvedTheme, setTheme } = useTheme();
  const { update } = useSettings();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const items = useMemo<Item[]>(() => {
    const pages: Item[] = NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => ({
        id: i.href,
        section: 'Pages',
        label: i.label,
        hint: g.label,
        icon: i.icon,
        keywords: i.keywords,
        run: () => go(UNFILTERED.includes(i.href) ? i.href : `${i.href}${globalQs}`),
      })),
    );
    const account: Item[] = ACCOUNT_ITEMS.map((i) => ({
      id: i.href,
      section: 'Pages',
      label: i.label,
      icon: i.icon,
      keywords: i.keywords,
      run: () => go(i.href),
    }));
    const admin: Item[] = isAdmin
      ? ADMIN_ITEMS.map((i) => ({
          id: i.href,
          section: 'Admin',
          label: i.label.replace('Admin · ', ''),
          hint: 'Admin',
          icon: i.icon,
          keywords: `admin ${i.keywords ?? ''}`,
          run: () => go(i.href),
        }))
      : [];
    const saved: Item[] = views.map((v) => ({
      id: `view:${v.id}`,
      section: 'Saved views',
      label: v.name,
      hint: `${PAGE_LABELS[v.path] ?? v.path} · ${describeQuery(v.query)}`,
      icon: Bookmark,
      run: () => go(v.query ? `${v.path}?${v.query}` : v.path),
    }));
    const actions: Item[] = [
      {
        id: 'theme',
        section: 'Actions',
        label: resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: resolvedTheme === 'dark' ? Sun : Moon,
        keywords: 'theme dark light appearance',
        run: () => {
          setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
          setOpen(false);
        },
      },
      {
        id: 'sidebar',
        section: 'Actions',
        label: 'Collapse or expand the sidebar',
        hint: '⌘B',
        icon: PanelLeft,
        keywords: 'sidebar menu',
        run: () => {
          update((s) => ({ ui: { ...s.ui, sidebarCollapsed: !s.ui.sidebarCollapsed } }));
          setOpen(false);
        },
      },
      { id: 'signout', section: 'Actions', label: 'Sign out', icon: LogOut, keywords: 'logout log out', run: () => void signOut() },
    ];
    return [...pages, ...account, ...admin, ...saved, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, isAdmin, globalQs, resolvedTheme]);

  const q = query.trim();
  const traceItem: Item[] = TRACE_ID.test(q)
    ? [
        {
          id: 'trace',
          section: 'Trace',
          label: `Open trace ${q.slice(0, 12)}…`,
          icon: Activity,
          run: () => go(`/traces/${q.toLowerCase()}`),
        },
      ]
    : [];
  // label starts with the query > label contains it > only hint/keywords match; ties keep the menu order
  const score = (i: Item) => {
    const l = i.label.toLowerCase();
    const ql = q.toLowerCase();
    return !ql ? 0 : l.startsWith(ql) ? 0 : l.includes(ql) ? 1 : 2;
  };
  const results = [
    ...traceItem,
    ...items
      .filter((i) => matches(i, q))
      .map((item, order) => ({ item, order, s: score(item) }))
      .sort((a, b) => a.s - b.s || a.order - b.order)
      .map((x) => x.item),
  ];
  const sections = [...new Set(results.map((r) => r.section))];

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    }
  };

  let index = -1;
  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setQuery('');
          setActive(0);
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[14vh] z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl outline-none"
          style={{ animation: 'menu-in 120ms ease-out' }}
        >
          <DialogPrimitive.Title className="sr-only">Search StackLens</DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Search pages, saved views, or paste a trace ID…"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Esc</kbd>
          </div>
          <div ref={listRef} className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
            {results.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{q}”</div>}
            {sections.map((section) => (
              <div key={section} className="pb-1">
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{section}</div>
                {results
                  .filter((r) => r.section === section)
                  .map((r) => {
                    index++;
                    const i = index;
                    return (
                      <button
                        key={r.id}
                        data-index={i}
                        onMouseMove={() => setActive(i)}
                        onClick={r.run}
                        className={cn(
                          'flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm cursor-pointer',
                          i === active ? 'bg-accent text-foreground' : 'text-foreground/90',
                        )}
                      >
                        <r.icon className={cn('size-4 shrink-0', i === active ? 'text-brand' : 'text-muted-foreground')} />
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                        {r.hint && <span className="max-w-[45%] truncate text-xs text-muted-foreground">{r.hint}</span>}
                        {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              <kbd className="font-mono">↑↓</kbd> to move
            </span>
            <span>
              <kbd className="font-mono">↵</kbd> to open
            </span>
            <span className="ml-auto">
              <kbd className="font-mono">⌘K</kbd> anywhere
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
