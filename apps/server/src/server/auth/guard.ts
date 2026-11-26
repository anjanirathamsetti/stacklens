import 'server-only';
import type { AuthUser, Role } from '@/lib/api-types';
import { getCurrentUser, hasRole } from './session';

/**
 * Route handler guard: 401 without a session, 403 below `minRole`, 403 for cross-site writes.
 *
 *   export const GET = withAuth('viewer', async (req, { user }) => …);
 *   export const DELETE = withAuth('admin', async (req, { user, params }) => …);
 */
export function withAuth<C extends object = object>(
  minRole: Role,
  handler: (req: Request, ctx: C & { user: AuthUser }) => Promise<Response> | Response,
  opts: { allowPendingPassword?: boolean } = {},
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    if (isCrossSiteWrite(req)) return Response.json({ error: 'cross-site request blocked' }, { status: 403 });
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: 'sign in required' }, { status: 401 });
    // a one-time password only lets you choose a real one
    if (user.mustChangePassword && !opts.allowPendingPassword)
      return Response.json({ error: 'choose a new password first', mustChangePassword: true }, { status: 403 });
    if (!hasRole(user, minRole)) return Response.json({ error: `requires the ${minRole} role` }, { status: 403 });
    return handler(req, { ...(ctx ?? ({} as C)), user });
  };
}

/**
 * Session cookies are SameSite=Lax, which already stops most cross-site POSTs; this also rejects
 * writes whose Origin header names another host.
 */
export function isCrossSiteWrite(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return false;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/* ------------------------------ rate limiting ------------------------------ */

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window limiter (per server process). Returns seconds to wait, or 0 when allowed. */
export function rateLimit(key: string, max: number, windowMs: number): number {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return 0;
  }
  b.count++;
  return b.count > max ? Math.ceil((b.resetAt - now) / 1000) : 0;
}

export function clearRateLimit(key: string): void {
  buckets.delete(key);
}
