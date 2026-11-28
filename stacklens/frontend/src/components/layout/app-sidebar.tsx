'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Shield,
  User,
  type LucideIcon,
} from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/brand/logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { openCommandPalette } from '@/components/layout/command-palette';
import { NAV_GROUPS, UNFILTERED, WORKSPACE_GROUP, isActive, type NavItem, type WorkspaceItem } from '@/components/layout/nav-config';
import { useFilters } from '@/lib/url-filters';
import { normalizeQuery, useSavedViews } from '@/lib/saved-views';
import { initials, useSettings } from '@/lib/settings-context';
import { ROLE_LABELS, signOut, useCurrentUser } from '@/lib/current-user';
import { cn } from '@/lib/utils';

/* ------------------------------- state hooks ------------------------------- */

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

/** Which groups are folded away (remembered per user). */
function useGroupOpen(id: string): [boolean, () => void] {
  const { settings, update } = useSettings();
  const closed = settings.ui.closedNavGroups ?? [];
  const toggle = useCallback(
    () =>
      update((s) => {
        const list = s.ui.closedNavGroups ?? [];
        return { ui: { ...s.ui, closedNavGroups: list.includes(id) ? list.filter((g) => g !== id) : [...list, id] } };
      }),
    [id, update],
  );
  return [!closed.includes(id), toggle];
}

/* -------------------------------- building blocks -------------------------------- */

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-viz/80 to-violet-500/80 font-semibold text-white',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Search box that opens the ⌘K palette. */
function SearchBox({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <Tooltip content="Search (⌘K)" side="right">
        <button
          onClick={openCommandPalette}
          className="mx-auto grid size-9 place-items-center rounded-lg border bg-background/70 text-muted-foreground shadow-xs transition-colors hover:text-foreground cursor-pointer"
          aria-label="Search"
        >
          <Search className="size-4" />
        </button>
      </Tooltip>
    );
  }
  return (
    <button
      onClick={openCommandPalette}
      className="group flex h-9 w-full items-center gap-2 rounded-lg border bg-background/70 px-2.5 text-sm text-muted-foreground shadow-xs transition-colors hover:border-foreground/15 hover:bg-background cursor-pointer"
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 text-left">Search…</span>
      <span className="flex items-center gap-0.5">
        <kbd className="grid h-5 min-w-5 place-items-center rounded border bg-muted px-1 font-mono text-[10px]">⌘</kbd>
        <kbd className="grid h-5 min-w-5 place-items-center rounded border bg-muted px-1 font-mono text-[10px]">K</kbd>
      </span>
    </button>
  );
}

/** One page link. Inside a group it hangs off the group's guide line. */
function NavLink({ item, collapsed, nested }: { item: NavItem; collapsed: boolean; nested?: boolean }) {
  const pathname = usePathname();
  const { globalQs } = useFilters();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  const link = (
    <Link
      href={UNFILTERED.includes(item.href) ? item.href : `${item.href}${globalQs}`}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center rounded-md text-sm transition-colors',
        collapsed ? 'mx-auto size-9 justify-center' : nested ? 'h-8 gap-2.5 px-2.5' : 'h-9 gap-2.5 px-2.5',
        active ? 'bg-brand/12 font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {nested && !collapsed && active && <span className="absolute -left-[13px] top-1.5 bottom-1.5 w-px bg-brand" />}
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/**
 * A collapsible section: header with icon and chevron, children indented on a guide line.
 * The header of the section holding the current page is raised like a card.
 */
function NavSection({
  id,
  label,
  icon: Icon,
  containsActive,
  collapsed,
  children,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  containsActive: boolean;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  const [open, toggle] = useGroupOpen(id);
  if (collapsed) return <div className="space-y-1 border-t border-border/60 pt-2 first:border-0 first:pt-0">{children}</div>;
  return (
    <div>
      <button
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          'group flex h-9 w-full items-center gap-2.5 rounded-lg border px-2.5 text-sm transition-all cursor-pointer',
          'font-semibold text-foreground',
          containsActive ? 'border-border bg-background shadow-xs' : 'border-transparent hover:bg-accent/60',
        )}
      >
        <Icon className={cn('size-4 shrink-0', containsActive && 'text-brand')} />
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200', !open && '-rotate-90')} />
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="ml-[18px] mt-1 space-y-0.5 border-l border-border pl-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Views pinned by the team. */
function PinnedViews({ collapsed }: { collapsed: boolean }) {
  const { views } = useSavedViews();
  const pathname = usePathname();
  const { sp } = useFilters();
  const pinned = views.filter((v) => v.pinned);
  if (!pinned.length) return null;
  const current = normalizeQuery(sp.toString());
  const isCurrent = (v: (typeof pinned)[number]) => v.path === pathname && normalizeQuery(v.query) === current;
  return (
    <NavSection id="saved" label="Saved views" icon={Bookmark} containsActive={pinned.some(isCurrent)} collapsed={collapsed}>
      {pinned.map((v) => {
        const active = isCurrent(v);
        const link = (
          <Link
            key={v.id}
            href={v.query ? `${v.path}?${v.query}` : v.path}
            aria-label={v.name}
            className={cn(
              'relative flex items-center rounded-md text-sm transition-colors',
              collapsed ? 'mx-auto size-9 justify-center' : 'h-8 gap-2.5 px-2.5',
              active ? 'bg-brand/12 font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            {!collapsed && active && <span className="absolute -left-[13px] top-1.5 bottom-1.5 w-px bg-brand" />}
            <Bookmark className={cn('size-3.5 shrink-0', active && 'fill-brand/20')} />
            {!collapsed && <span className="truncate">{v.name}</span>}
          </Link>
        );
        return collapsed ? (
          <Tooltip key={v.id} content={v.name} side="right">
            {link}
          </Tooltip>
        ) : (
          link
        );
      })}
    </NavSection>
  );
}

const linkClass = (active: boolean, collapsed: boolean, size: 'h-8' | 'h-7' = 'h-8') =>
  cn(
    'group relative flex items-center rounded-md text-sm transition-colors',
    collapsed ? 'mx-auto size-9 justify-center' : `${size} gap-2.5 px-2.5`,
    active ? 'bg-brand/12 font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
  );

/** Is this Workspace entry (or one of its sub-pages) the current page? */
function useWorkspaceMatch() {
  const pathname = usePathname();
  const tab = useSearchParams().get('tab') ?? 'profile';
  const self = (i: WorkspaceItem) => (i.tabs ? pathname === '/settings' && i.tabs.includes(tab) : isActive(pathname, i.href.split('?')[0]));
  const child = (c: NonNullable<WorkspaceItem['children']>[number]) =>
    c.tab ? pathname === '/settings' && tab === c.tab : isActive(pathname, c.href);
  return { self, child };
}

/** One Workspace entry; Settings and Admin unfold into their sub-pages (open while you're on one). */
function WorkspaceLink({ item, collapsed }: { item: WorkspaceItem; collapsed: boolean }) {
  const match = useWorkspaceMatch();
  const active = match.self(item);
  const [open, setOpen] = useState(active);
  // unfold when navigating into the section, fold again when leaving it (the chevron toggles in between)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(active), [active]);
  const Icon = item.icon;
  const hasChildren = !!item.children?.length && !collapsed;
  const link = (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active && !hasChildren ? 'page' : undefined}
      className={cn(linkClass(active && !hasChildren, collapsed), hasChildren && active && 'text-foreground', hasChildren && 'pr-8')}
    >
      {!collapsed && active && !hasChildren && <span className="absolute -left-[13px] top-1.5 bottom-1.5 w-px bg-brand" />}
      <Icon className={cn('size-4 shrink-0', hasChildren && active && 'text-brand')} />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && item.shortcut && !hasChildren && (
        <kbd className="font-mono text-[10px] text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">
          {item.shortcut}
        </kbd>
      )}
    </Link>
  );
  if (collapsed)
    return (
      <Tooltip content={item.shortcut ? `${item.label} (${item.shortcut})` : item.label} side="right">
        {link}
      </Tooltip>
    );
  if (!hasChildren) return link;
  return (
    <div>
      <div className="relative">
        {link}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${item.label} pages`}
          className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground/70 hover:bg-accent hover:text-foreground cursor-pointer"
        >
          <ChevronRight className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />
        </button>
      </div>
      <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="ml-[17px] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
            {item.children!.map((c) => {
              const on = match.child(c);
              const CIcon = c.icon;
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  aria-current={on ? 'page' : undefined}
                  className={cn(linkClass(on, false, 'h-7'), 'text-[13px]')}
                >
                  {on && <span className="absolute -left-[11px] top-1 bottom-1 w-px bg-brand" />}
                  <CIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{c.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceSection({ collapsed }: { collapsed: boolean }) {
  const { can } = useCurrentUser();
  const match = useWorkspaceMatch();
  const items = WORKSPACE_GROUP.items.filter((i) => !i.adminOnly || can('admin'));
  return (
    <NavSection
      id={WORKSPACE_GROUP.id}
      label={WORKSPACE_GROUP.label}
      icon={WORKSPACE_GROUP.icon}
      containsActive={items.some((i) => match.self(i))}
      collapsed={collapsed}
    >
      {items.map((i) => (
        <WorkspaceLink key={i.href} item={i} collapsed={collapsed} />
      ))}
    </NavSection>
  );
}

function Nav({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  return (
    <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden pb-3', collapsed ? 'space-y-2 px-2' : 'space-y-1.5 px-3')}>
      {NAV_GROUPS.map((g) => (
        <NavSection
          key={g.id}
          id={g.id}
          label={g.label}
          icon={g.icon}
          containsActive={g.items.some((i) => isActive(pathname, i.href))}
          collapsed={collapsed}
        >
          {g.items.map((i) => (
            <NavLink key={i.href} item={i} collapsed={collapsed} nested />
          ))}
        </NavSection>
      ))}
      <WorkspaceSection collapsed={collapsed} />
      <PinnedViews collapsed={collapsed} />
    </nav>
  );
}

/**
 * Account button at the bottom of the sidebar: profile, admin and sign-out only.
 * Settings, the setup guide, shortcuts and admin pages are in the Workspace group.
 */
function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const { user, can } = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();
  const { name, email } = user;
  const role = ROLE_LABELS[user.role].label;
  const sp = useSearchParams();
  const onAccountPage = pathname === '/settings' && (sp.get('tab') ?? 'profile') === 'profile';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <button
            className={cn(
              'relative mx-auto rounded-full outline-none ring-offset-2 ring-offset-shell transition hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:ring-2 data-[state=open]:ring-brand/50 cursor-pointer',
              onAccountPage && 'ring-2 ring-brand/50',
            )}
            aria-label="Account menu"
          >
            <Avatar name={name} className="size-8 text-[11px]" />
          </button>
        ) : (
          <button
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-lg border border-transparent p-1.5 text-left outline-none transition-all cursor-pointer',
              'hover:border-border hover:bg-background hover:shadow-xs focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-border data-[state=open]:bg-background data-[state=open]:shadow-xs',
              onAccountPage && 'border-border bg-background shadow-xs',
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
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          </div>
          <span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{role}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/settings?tab=profile')}>
          <User /> Profile
        </DropdownMenuItem>
        {can('admin') && (
          <DropdownMenuItem onSelect={() => router.push('/admin')}>
            <Shield /> Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* --------------------------------- sidebar --------------------------------- */

export function AppSidebar() {
  const [collapsed, setCollapsed] = useCollapsed();
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !el?.closest('input,textarea,[contenteditable="true"]'))
        router.push('/settings?tab=shortcuts');
      // ⌘, opens Settings (the conventional preferences shortcut)
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        router.push('/settings?tab=appearance');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <aside className={cn('hidden shrink-0 flex-col bg-shell md:flex', collapsed ? 'w-[64px]' : 'w-[248px]')}>
      {/* brand */}
      <div className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'justify-between pl-4 pr-2.5')}>
        {collapsed ? (
          <Tooltip content="Expand sidebar (⌘B)" side="right">
            <button
              onClick={() => setCollapsed(false)}
              className="group relative grid size-9 place-items-center rounded-lg cursor-pointer"
              aria-label="Expand sidebar"
            >
              <LogoMark className="size-7 transition-opacity group-hover:opacity-0" />
              <PanelLeftOpen className="absolute size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </Tooltip>
        ) : (
          <>
            <Link href="/overview" className="flex min-w-0 items-center gap-2.5" aria-label="StackLens home">
              <LogoMark className="size-7" />
              <Wordmark className="truncate text-[19px]" />
            </Link>
            <Tooltip content="Collapse sidebar (⌘B)" side="right">
              <button
                onClick={() => setCollapsed(true)}
                className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground cursor-pointer"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {/* search */}
      <div className={cn('shrink-0 pb-4 pt-1', collapsed ? 'px-2' : 'px-3')}>
        <SearchBox collapsed={collapsed} />
      </div>

      <Suspense>
        <Nav collapsed={collapsed} />
      </Suspense>

      {/* account */}
      <div className={cn('shrink-0 border-t border-border/70 pb-3 pt-2', collapsed ? 'flex justify-center px-2' : 'px-3')}>
        <Suspense>
          <AccountMenu collapsed={collapsed} />
        </Suspense>
      </div>
    </aside>
  );
}
