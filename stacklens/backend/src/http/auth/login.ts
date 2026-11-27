import { dummyHash, verifyPassword } from '../../auth/password';
import { clearRateLimit, isCrossSiteWrite, rateLimit } from '../../auth/guard';
import { clientMeta, startSession } from '../../auth/session';
import { audit, getUserWithHash, validEmail } from '../../repositories/account-repository';
import { route } from '../request-context';

const WINDOW = 15 * 60_000;
const INVALID = 'Incorrect email or password';

async function handlePOST(req: Request) {
  if (isCrossSiteWrite(req)) return Response.json({ error: 'cross-site request blocked' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!validEmail(email) || !password) return Response.json({ error: INVALID }, { status: 400 });

  const { ip } = await clientMeta();
  // per account (whatever the address) and, when the client address is known, per address
  const wait = Math.max(rateLimit(`login:${email}`, 10, WINDOW), ip ? rateLimit(`login-ip:${ip}`, 40, WINDOW) : 0);
  if (wait) {
    return Response.json(
      { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.` },
      { status: 429, headers: { 'retry-after': String(wait) } },
    );
  }

  const user = await getUserWithHash({ email });
  // verify against a dummy hash for unknown emails so response time doesn't reveal which accounts exist
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !ok) {
    await audit(null, 'login.failed', email, {}, ip);
    return Response.json({ error: INVALID }, { status: 401 });
  }
  if (user.disabled) {
    await audit(user, 'login.blocked', email, { reason: 'disabled' }, ip);
    return Response.json({ error: 'This account is disabled. Ask an admin to re-enable it.' }, { status: 403 });
  }

  clearRateLimit(`login:${email}`);
  const { passwordHash: _hash, ...safe } = user;
  void _hash;
  await startSession(safe);
  await audit(safe, 'login', email, {}, ip);
  return Response.json({ user: safe });
}

export const POST = route(handlePOST);
