import type { SloInput } from '@/lib/api-types';
import { createSlo, sloStatuses, validateSlo } from '@/server/repositories/slo-repository';
import { withAuth } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

export const GET = withAuth('viewer', async () => {
  return Response.json({ slos: await sloStatuses() });
});

export const POST = withAuth('member', async (req: Request) => {
  const body = (await req.json().catch(() => null)) as Partial<SloInput> | null;
  const err = body ? validateSlo(body) : 'invalid JSON body';
  if (err) return Response.json({ error: err }, { status: 400 });
  return Response.json({ slo: await createSlo(body as SloInput) }, { status: 201 });
});
