import { createView, listViews, validateView, type ViewInput } from '../repositories/view-repository';
import { withAuth } from '../auth/guard';

export const GET = withAuth('viewer', async () => {
  return Response.json({ views: await listViews() });
});

export const POST = withAuth('member', async (req, { user }) => {
  const body = (await req.json().catch(() => null)) as Partial<ViewInput> | null;
  const err = body ? validateView(body) : 'invalid JSON body';
  if (err) return Response.json({ error: err }, { status: 400 });
  return Response.json({ view: await createView({ ...(body as ViewInput), createdBy: user.name }) }, { status: 201 });
});
