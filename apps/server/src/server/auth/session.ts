import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import type { AuthUser, Role } from '@/lib/api-types';
import { env } from '../env';
import { getConfig } from '../repositories/config-repository';
import { createSession, deleteSession, userForSession } from '../repositories/account-repository';

export const SESSION_COOKIE = 'stacklens_session';

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };
export const hasRole = (user: Pick<AuthUser, 'role'>, min: Role) => RANK[user.role] >= RANK[min];

export async function clientMeta(): Promise<{ ip?: string; userAgent?: string; secure: boolean }> {
  const h = await headers();
  // forwarded headers are client-controlled unless a trusted proxy overwrites them
  const ip = env.trustProxy ? h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined : undefined;
  const proto = h.get('x-forwarded-proto') ?? (env.publicUrl?.startsWith('https://') ? 'https' : 'http');
  return { ip, userAgent: h.get('user-agent') ?? undefined, secure: proto === 'https' };
}

/** The signed-in user for this request (memoized per request), or undefined. */
export const getCurrentUser = cache(async (): Promise<AuthUser | undefined> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const { sessionDays } = await getConfig('security');
  return userForSession(token, sessionDays);
});

export async function startSession(user: AuthUser): Promise<void> {
  const { sessionDays } = await getConfig('security');
  const meta = await clientMeta();
  const { token, expiresAt } = await createSession(user.id, sessionDays, meta);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: meta.secure,
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  jar.delete(SESSION_COOKIE);
}

export async function currentToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
