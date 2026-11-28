import { Cable, Database, KeyRound, Lock, Plug, ScrollText, Sparkles, Users } from 'lucide-react';

/** Team settings pages (admins only), listed in the Settings menu (see features/settings/settings-nav). */
export const ADMIN_SECTIONS = [
  {
    group: 'Access',
    items: [
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/api-keys', label: 'API keys', icon: KeyRound },
      { href: '/admin/security', label: 'Security', icon: Lock },
    ],
  },
  {
    group: 'Team settings',
    items: [
      { href: '/admin/ai', label: 'AI assistant', icon: Sparkles },
      { href: '/admin/mcp', label: 'MCP server', icon: Cable },
      { href: '/admin/integrations', label: 'Integrations', icon: Plug },
      { href: '/admin/data', label: 'Data & storage', icon: Database },
    ],
  },
  { group: 'Activity', items: [{ href: '/admin/audit', label: 'Audit log', icon: ScrollText }] },
];
