import {
  Activity,
  BookOpen,
  Bug,
  Flame,
  Gauge,
  Keyboard,
  LayoutDashboard,
  Newspaper,
  Palette,
  Radar,
  Settings,
  ShieldCheck,
  Siren,
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

/** Pinned above the account row: everyone's way into setup and settings (team settings included, for admins). */
export const BOTTOM_LINKS: (NavItem & { shortcut?: string; match: string[] })[] = [
  { href: '/setup', label: 'Setup guide', icon: BookOpen, match: ['/setup'], keywords: 'install sdk instrument python node' },
  {
    href: '/settings?tab=profile',
    label: 'Settings',
    icon: Settings,
    shortcut: '⌘,',
    match: ['/settings', '/admin'],
    keywords: 'profile preferences admin',
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

export const ADMIN_ITEMS: NavItem[] = ADMIN_SECTIONS.flatMap((g) => g.items).map((i) => ({ ...i, label: `Settings · ${i.label}` }));

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/');
