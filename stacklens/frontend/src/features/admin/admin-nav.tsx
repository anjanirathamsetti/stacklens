'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Cable, Database, KeyRound, Lock, Plug, ScrollText, Shield, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

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

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden w-56 shrink-0 flex-col border-r bg-muted/20 md:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Shield className="size-4 text-brand" />
        <span className="text-sm font-semibold">Admin</span>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-2.5 pt-4">
        {ADMIN_SECTIONS.map((g) => (
          <div key={g.group}>
            <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{g.group}</div>
            <div className="space-y-0.5">
              {g.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + '/');
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      active && 'bg-accent font-medium text-foreground',
                    )}
                  >
                    <Icon className={cn('size-4', active && 'text-brand')} />
                    {label}
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

/** Section menu as a select on small screens, where the side menu is hidden. */
export function AdminMobileNav() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b px-4 py-2 md:hidden">
      {ADMIN_SECTIONS.flatMap((g) => g.items).map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-muted-foreground',
            pathname.startsWith(href) && 'bg-accent text-foreground',
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
