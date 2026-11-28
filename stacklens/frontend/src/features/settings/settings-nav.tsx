'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Gauge, Keyboard, Palette, Settings, User, type LucideIcon } from 'lucide-react';
import { ADMIN_SECTIONS } from '@/features/admin/admin-nav';
import { useCurrentUser } from '@/lib/current-user';
import { cn } from '@/lib/utils';

interface SettingsLink {
  href: string;
  label: string;
  icon: LucideIcon;
  /** `?tab=` of /settings this link opens */
  tab?: string;
}

interface SettingsGroup {
  group: string;
  /** team-wide settings: shown to admins only (the /admin routes check the role again) */
  admin?: boolean;
  items: SettingsLink[];
}

/**
 * One menu for every settings page: your own (account and preferences) and, for admins, the team's.
 * /settings?tab=… and /admin/… share it, so each page is listed exactly once.
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  { group: 'Account', items: [{ href: '/settings?tab=profile', tab: 'profile', label: 'Profile', icon: User }] },
  {
    group: 'Preferences',
    items: [
      { href: '/settings?tab=appearance', tab: 'appearance', label: 'Appearance', icon: Palette },
      { href: '/settings?tab=thresholds', tab: 'thresholds', label: 'Health thresholds', icon: Gauge },
      { href: '/settings?tab=shortcuts', tab: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
    ],
  },
  ...ADMIN_SECTIONS.map((g) => ({ group: g.group, admin: true, items: g.items })),
];

export const SETTINGS_TABS = SETTINGS_GROUPS.flatMap((g) => g.items).flatMap((i) => (i.tab ? [i.tab] : []));

function useVisibleGroups() {
  const { can } = useCurrentUser();
  return SETTINGS_GROUPS.filter((g) => !g.admin || can('admin'));
}

function useIsActive() {
  const pathname = usePathname();
  const tab = useSearchParams().get('tab') ?? 'profile';
  return (l: SettingsLink) =>
    l.tab ? pathname === '/settings' && tab === l.tab : pathname === l.href || pathname.startsWith(l.href + '/');
}

export function SettingsNav() {
  const groups = useVisibleGroups();
  const isActive = useIsActive();
  return (
    <nav className="hidden w-56 shrink-0 flex-col border-r bg-muted/20 md:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Settings className="size-4 text-brand" />
        <span className="text-sm font-semibold">Settings</span>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-2.5 pt-4">
        {groups.map((g, i) => (
          <div key={g.group}>
            <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {g.group}
              {g.admin && !groups[i - 1]?.admin && (
                <span className="rounded bg-muted px-1 py-px text-[9.5px] font-medium normal-case tracking-normal">Admins</span>
              )}
            </div>
            <div className="space-y-0.5">
              {g.items.map((l) => {
                const active = isActive(l);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    scroll={false}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      active && 'bg-accent font-medium text-foreground',
                    )}
                  >
                    <l.icon className={cn('size-4', active && 'text-brand')} />
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** The same menu as a scrolling row on small screens, where the side menu is hidden. */
export function SettingsMobileNav() {
  const groups = useVisibleGroups();
  const isActive = useIsActive();
  return (
    <div className="flex gap-1 overflow-x-auto border-b px-4 py-2 md:hidden">
      {groups
        .flatMap((g) => g.items)
        .map((l) => (
          <Link
            key={l.href}
            href={l.href}
            scroll={false}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-muted-foreground',
              isActive(l) && 'bg-accent text-foreground',
            )}
          >
            {l.label}
          </Link>
        ))}
    </div>
  );
}
