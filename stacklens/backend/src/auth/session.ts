import 'server-only';
import type { AuthUser, Role } from '@stacklens/shared/api-types';
import { env } from '../env';
import { getConfig } from '../repositories/config-repository';
import { createSession, deleteSession, userForSession } from '../repositories/account-repository';
import { deleteResponseCookie, perRequest, requestCookie, requestHeader, setResponseCookie } from '../http/request-context';

export const SESSION_COOKIE = 'stacklens_session';

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };
export const hasRole = (user: Pick<AuthUser, 'role'>, min: Role) => RANK[user.role] >= RANK[min];

/** Client address, user agent and whether the request came over HTTPS (inside a handler). */
export async function clientMeta(): Promise<{ ip?: string; userAgent?: string; secure: boolean }> {
  // forwarded headers are client-controlled unless a trusted proxy overwrites them
  const ip = env.trustProxy
    ? requestHeader('x-forwarded-for')?.split(',')[0]?.trim() || requestHeader('x-real-ip') || undefined
    : undefined;
  const proto = requestHeader('x-forwarded-proto') ?? (env.publicUrl?.startsWith('https://') ? 'https' : 'http');
  return { ip, userAgent: requestHeader('user-agent') ?? undefined, secure: proto === 'https' };
}

/**
 * The user behind a session token (from a cookie), or undefined. Used directly by server-rendered
 * pages, which read the cookie themselves.
 */
export async function userForToken(token: string | undefined): Promise<AuthUser | undefined> {
  if (!token) return undefined;
  const { sessionDays } = await getConfig('security');
  return userForSession(token, sessionDays);
}

/** The signed-in user for the current request (memoized per request), or undefined. */
export function getCurrentUser(): Promise<AuthUser | undefined> {
  return perRequest('currentUser', () => userForToken(requestCookie(SESSION_COOKIE)));
}

export async function startSession(user: AuthUser): Promise<void> {
  const { sessionDays } = await getConfig('security');
  const meta = await clientMeta();
  const { token, expiresAt } = await createSession(user.id, sessionDays, meta);
  setResponseCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: meta.secure,
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const token = requestCookie(SESSION_COOKIE);
  if (token) await deleteSession(token);
  deleteResponseCookie(SESSION_COOKIE);
}

export async function currentToken(): Promise<string | undefined> {
  return requestCookie(SESSION_COOKIE);
}
