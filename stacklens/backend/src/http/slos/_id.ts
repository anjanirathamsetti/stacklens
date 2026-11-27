import type { SloInput } from '@stacklens/shared/api-types';
import { deleteSlo, updateSlo, validateSlo } from '../../repositories/slo-repository';
import { withAuth } from '../../auth/guard';

export const PUT = withAuth('member', async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const body = (await req.json().catch(() => null)) as Partial<SloInput> | null;
  const err = body ? validateSlo(body) : 'invalid JSON body';
  if (err) return Response.json({ error: err }, { status: 400 });
  const slo = await updateSlo((await params).id, body as SloInput);
  return slo ? Response.json({ slo }) : Response.json({ error: 'not found' }, { status: 404 });
});

export const DELETE = withAuth('member', async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  return (await deleteSlo((await params).id))
    ? new Response(null, { status: 204 })
    : Response.json({ error: 'not found' }, { status: 404 });
});
