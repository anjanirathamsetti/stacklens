import { deleteView, updateView, validateView, type ViewInput } from '../../repositories/view-repository';
import { withAuth } from '../../auth/guard';

export const PATCH = withAuth('member', async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const body = (await req.json().catch(() => null)) as Partial<ViewInput> | null;
  const err = body ? validateView(body, true) : 'invalid JSON body';
  if (err) return Response.json({ error: err }, { status: 400 });
  const view = await updateView((await params).id, body!);
  return view ? Response.json({ view }) : Response.json({ error: 'not found' }, { status: 404 });
});

export const DELETE = withAuth('member', async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  return (await deleteView((await params).id))
    ? new Response(null, { status: 204 })
    : Response.json({ error: 'not found' }, { status: 404 });
});
