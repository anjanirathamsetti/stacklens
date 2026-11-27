'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import type { AuthUser, Role } from '@stacklens/shared/api-types';

/** The signed-in user, provided by the server layout so the first paint already knows who it is. */

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

const Ctx = createContext<{ user: AuthUser; setUser: (u: AuthUser) => void } | null>(null);

export function CurrentUserProvider({ user: initial, children }: { user: AuthUser; children: React.ReactNode }) {
  const [user, setUser] = useState(initial);
  return <Ctx.Provider value={{ user, setUser }}>{children}</Ctx.Provider>;
}

export function useCurrentUser() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCurrentUser outside CurrentUserProvider');
  const can = useCallback((min: Role) => RANK[ctx.user.role] >= RANK[min], [ctx.user.role]);
  return { ...ctx, can };
}

export const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  admin: { label: 'Admin', description: 'Everything, plus users, API keys and team settings' },
  member: { label: 'Member', description: 'Use StackLens and create views, SLOs and incidents' },
  viewer: { label: 'Viewer', description: 'Read-only access to traces, errors and dashboards' },
};

export async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  try {
    localStorage.removeItem('stacklens.settings');
  } catch {}
  window.location.assign('/login');
}

/** Lets a component show controls only to roles that can use them. */
export function useCan(min: Role): boolean {
  return useCurrentUser().can(min);
}
