import {
  Activity,
  BookOpen,
  Bug,
  Flame,
  Gauge,
  Keyboard,
  LifeBuoy,
  LayoutDashboard,
  Newspaper,
  Palette,
  Radar,
  Settings,
  Shield,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { ADMIN_SECTIONS } from '@/features/admin/admin-nav';

/** Navigation shared by the sidebar and the search palette. */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** extra words the search palette matches on */
  keywords?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'observe',
    label: 'Observability',
    icon: Radar,
    items: [
      { href: '/overview', label: 'Overview', icon: LayoutDashboard, keywords: 'dashboard kpi charts metrics' },
      { href: '/traces', label: 'Traces', icon: Activity, keywords: 'requests logs call tree' },
      { href: '/errors', label: 'Errors', icon: Bug, keywords: 'exceptions failures' },
      { href: '/incidents', label: 'Incidents', icon: Siren, keywords: 'servicenow tickets' },
      { href: '/hotspots', label: 'Hotspots', icon: Flame, keywords: 'functions slow self time' },
    ],
  },
  {
    id: 'reliability',
    label: 'Reliability',
    icon: ShieldCheck,
    items: [
      { href: '/slos', label: 'SLOs', icon: Target, keywords: 'objectives error budget' },
      { href: '/digest', label: 'Daily digest', icon: Newspaper, keywords: 'summary report slack' },
    ],
  },
];

/** A link in one of the lower sidebar groups. `tab` marks a tab of /settings (matched on `?tab=`). */
export interface SideItem extends NavItem {
  tab?: string;
  /** shown on hover, e.g. `?` */
  shortcut?: string;
}

export interface SideGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** shown to admins only */
  adminOnly?: boolean;
  items: SideItem[];
}

/**
 * Below the data sections: personal preferences, team administration (admins) and help.
 * The profile lives in the account menu at the bottom of the sidebar.
 */
export const SIDE_GROUPS: SideGroup[] = [
  {
    id: 'preferences',
    label: 'Preferences',
    icon: SlidersHorizontal,
    items: [
      {
        href: '/settings?tab=appearance',
        tab: 'appearance',
        label: 'Appearance',
        icon: Palette,
        shortcut: '⌘,',
        keywords: 'theme dark light time format',
      },
      { href: '/settings?tab=thresholds', tab: 'thresholds', label: 'Health thresholds', icon: Gauge, keywords: 'latency error rate' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Shield,
    adminOnly: true,
    items: ADMIN_SECTIONS.flatMap((g) => g.items),
  },
  {
    id: 'help',
    label: 'Help',
    icon: LifeBuoy,
    items: [
      { href: '/setup', label: 'Setup guide', icon: BookOpen, keywords: 'install sdk instrument python node' },
      {
        href: '/settings?tab=shortcuts',
        tab: 'shortcuts',
        label: 'Keyboard shortcuts',
        icon: Keyboard,
        shortcut: '?',
        keywords: 'keys hotkeys',
      },
    ],
  },
];

/** Pages that don't take the global filters (time range, app, user) along. */
export const UNFILTERED = ['/setup', '/settings', '/admin'];

export const ACCOUNT_ITEMS: NavItem[] = [
  { href: '/settings?tab=profile', label: 'Settings', icon: Settings, keywords: 'profile password appearance theme thresholds' },
  { href: '/settings?tab=appearance', label: 'Settings · Appearance', icon: Palette, keywords: 'theme dark light time format' },
  { href: '/settings?tab=thresholds', label: 'Settings · Health thresholds', icon: Gauge, keywords: 'latency error rate' },
  { href: '/setup', label: 'Setup guide', icon: BookOpen, keywords: 'install sdk instrument python node' },
  { href: '/settings?tab=shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, keywords: 'keys hotkeys' },
];

export const ADMIN_ITEMS: NavItem[] = ADMIN_SECTIONS.flatMap((g) => g.items).map((i) => ({ ...i, label: `Admin · ${i.label}` }));

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/');
