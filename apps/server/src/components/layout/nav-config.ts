import {
  Activity,
  BookOpen,
  Bug,
  Flame,
  Keyboard,
  LayoutDashboard,
  Newspaper,
  Radar,
  Settings,
  Shield,
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

/** Shown to admins only, as a single top-level entry. */
export const ADMIN_ITEM: NavItem = { href: '/admin', label: 'Admin', icon: Shield, keywords: 'users keys security' };

/** Pages that don't take the global filters (time range, app, user) along. */
export const UNFILTERED = ['/setup', '/settings', '/admin'];

export const ACCOUNT_ITEMS: NavItem[] = [
  { href: '/settings?tab=profile', label: 'Settings', icon: Settings, keywords: 'profile password appearance theme thresholds' },
  { href: '/setup', label: 'Setup guide', icon: BookOpen, keywords: 'install sdk instrument' },
  { href: '/settings?tab=shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, keywords: 'keys hotkeys' },
];

export const ADMIN_ITEMS: NavItem[] = ADMIN_SECTIONS.flatMap((g) => g.items).map((i) => ({ ...i, label: `Admin · ${i.label}` }));

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/');
