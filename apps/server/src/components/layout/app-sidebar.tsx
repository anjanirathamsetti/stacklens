'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect } from 'react';
import { useFilters } from '@/lib/url-filters';
import {
  Activity,
  BookOpen,
  Bug,
  Flame,
  LayoutDashboard,
  Layers,
  Siren,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  User,
  ChevronsUpDown,
  Keyboard,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initials, useSettings } from '@/lib/settings-context';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const NAV = [
  {
    group: 'Observe',
    items: [
      { href: '/overview', label: 'Overview', icon: LayoutDashboard },
      { href: '/traces', label: 'Traces', icon: Activity },
      { href: '/errors', label: 'Errors', icon: Bug },
      { href: '/incidents', label: 'Incidents', icon: Siren },
      { href: '/hotspots', label: 'Hotspots', icon: Flame },
    ],
  },
];

/** Collapsed state lives in the user's settings; ⌘B / Ctrl+B toggles it. */
function useCollapsed() {
  const { settings, update } = useSettings();
  const collapsed = settings.ui.sidebarCollapsed;
  const set = useCallback((v: boolean) => update((s) => ({ ui: { ...s.ui, sidebarCollapsed: v } })), [update]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && !(e.target as HTMLElement)?.closest('input,textarea')) {
        e.preventDefault();
        update((s) => ({ ui: { ...s.ui, sidebarCollapsed: !s.ui.sidebarCollapsed } }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update]);
  return [collapsed, set] as const;
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand/80 to-violet-500/80 font-semibold text-white',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Account button at the bottom of the sidebar (Linear / Vercel style).
 * Opens a compact menu – everything else lives on the Settings page.
 */
function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const { settings } = useSettings();
  const pathname = usePathname();
  const router = useRouter();
  const { name, email, role } = settings.profile;
  const onAccountPage = pathname.startsWith('/settings') || pathname.startsWith('/setup');

  // ⌘, opens Settings (the conventional preferences shortcut)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        router.push('/settings?tab=appearance');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <button
            className={cn(
              'relative rounded-full outline-none ring-offset-2 ring-offset-sidebar transition hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:ring-2 data-[state=open]:ring-brand/50 cursor-pointer',
              onAccountPage && 'ring-2 ring-brand/50',
            )}
            aria-label="Account menu"
          >
            <Avatar name={name} className="size-8 text-[11px]" />
          </button>
        ) : (
          <button
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none transition-colors cursor-pointer',
              'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent',
              onAccountPage && 'bg-accent/70',
            )}
            aria-label="Account menu"
          >
            <Avatar name={name} className="size-8 rounded-lg text-[11px]" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{email || role}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={collapsed ? 12 : 10} className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={name} className="size-9 rounded-lg text-xs" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{email || role}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/settings?tab=profile')}>
          <User /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/settings?tab=appearance')}>
          <Settings /> Settings
          <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/setup')}>
          <BookOpen /> Setup guide
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/settings?tab=shortcuts')}>
          <Keyboard /> Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavLinks({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const { globalQs } = useFilters();
  return (
    <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden py-4', collapsed ? 'space-y-3 px-2' : 'space-y-5 px-2.5')}>
      {NAV.map((g) => (
        <div key={g.group}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-border first:hidden" />
          ) : (
            <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap text-muted-foreground/80">
              {g.group}
            </div>
          )}
          <div className="space-y-0.5">
            {g.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/');
              const link = (
                <Link
                  key={href}
                  href={href === '/setup' || href === '/settings' ? href : `${href}${globalQs}`}
                  aria-label={label}
                  className={cn(
                    'relative flex h-9 items-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                    collapsed ? 'mx-auto w-9 justify-center' : 'gap-2.5 px-2.5',
                    active && 'bg-accent font-medium text-foreground',
                  )}
                >
                  {active && <span className="absolute -left-2.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-brand" />}
                  <Icon className={cn('size-4 shrink-0', active && 'text-brand')} />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={href} content={label} side="right">
                  {link}
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppSidebar() {
  const [collapsed, setCollapsed] = useCollapsed();
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !el?.closest('input,textarea,[contenteditable="true"]'))
        router.push('/settings?tab=shortcuts');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
  return (
    <aside className={cn('hidden shrink-0 flex-col border-r bg-sidebar md:flex', collapsed ? 'w-[60px]' : 'w-56')}>
      <div className={cn('flex h-14 shrink-0 items-center border-b', collapsed ? 'justify-center px-2' : 'justify-between pl-4 pr-2')}>
        {collapsed ? (
          <Tooltip content="Expand sidebar (⌘B)" side="right">
            <button
              onClick={() => setCollapsed(false)}
              className="group relative grid size-8 place-items-center rounded-md cursor-pointer"
              aria-label="Expand sidebar"
            >
              <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground transition-opacity group-hover:opacity-0">
                <Layers className="size-4" />
              </span>
              <PanelLeftOpen className="absolute size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </Tooltip>
        ) : (
          <Link href="/overview" className="flex min-w-0 items-center gap-2" aria-label="StackLens home">
            <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <Layers className="size-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-semibold tracking-tight">StackLens</div>
                <div className="truncate text-[10px] text-muted-foreground">call-tree tracer</div>
              </div>
            )}
          </Link>
        )}
        {!collapsed && (
          <Tooltip content="Collapse sidebar (⌘B)" side="right">
            <button
              onClick={() => setCollapsed(true)}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>
      <Suspense>
        <NavLinks collapsed={collapsed} />
      </Suspense>
      <div className={cn('border-t', collapsed ? 'flex justify-center py-3' : 'p-2')}>
        <Suspense>
          <AccountMenu collapsed={collapsed} />
        </Suspense>
      </div>
    </aside>
  );
}
