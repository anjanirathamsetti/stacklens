import { hashPassword, passwordProblem } from '@/server/auth/password';
import { isCrossSiteWrite, rateLimit } from '@/server/auth/guard';
import { clientMeta, startSession } from '@/server/auth/session';
import { getConfig } from '@/server/repositories/config-repository';
import { audit, createFirstAdmin, validEmail } from '@/server/repositories/account-repository';

export const dynamic = 'force-dynamic';

/** First-run: creates the first account as admin. Refuses once any account exists. */
export async function POST(req: Request) {
  if (isCrossSiteWrite(req)) return Response.json({ error: 'cross-site request blocked' }, { status: 403 });
  const { ip } = await clientMeta();
  if (rateLimit(`setup:${ip}`, 10, 15 * 60_000)) return Response.json({ error: 'Too many attempts' }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown; password?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) return Response.json({ error: 'Enter your name' }, { status: 400 });
  if (!validEmail(body?.email)) return Response.json({ error: 'Enter a valid email address' }, { status: 400 });
  const { minPasswordLength } = await getConfig('security');
  const problem = passwordProblem(body?.password, minPasswordLength);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const user = await createFirstAdmin({ name, email: body!.email as string, passwordHash: await hashPassword(body!.password as string) });
  if (!user) return Response.json({ error: 'Setup is already complete. Sign in instead.' }, { status: 409 });
  await startSession(user);
  await audit(user, 'setup.admin_created', user.email, {}, ip);
  return Response.json({ user }, { status: 201 });
}
