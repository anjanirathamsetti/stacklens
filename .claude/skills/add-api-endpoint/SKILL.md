---
name: add-api-endpoint
description: Add or change a StackLens HTTP API endpoint (backend handler + frontend route adapter + client types). Use when a feature needs a new /api/* route.
---

# Add an API endpoint

1. **Handler** – create `stacklens/backend/src/http/<segments>.ts` (dynamic segments as `_id`):
   ```ts
   import type { AuthUser } from '@stacklens/shared/api-types';
import { withAuth } from '../auth/guard';           // adjust ../ depth
   import { listThings } from '../repositories/thing-repository';

   export const GET = withAuth('viewer', async (req) => {
     const url = new URL(req.url);
     return Response.json({ items: await listThings(url.searchParams.get('q') ?? '') });
   });

   export const PATCH = withAuth('member', async (req: Request, { params, user }: { params: Promise<{ id: string }>; user: AuthUser }) => {
     const { id } = await params;
     const body = await req.json().catch(() => null);
     if (!body || typeof body.name !== 'string') return Response.json({ error: 'name is required' }, { status: 400 });
     …
   });
   ```
   Pick the lowest role that is safe. Public endpoints use `route(handler)` from `../request-context` and must do their own checks.
2. **SQL** – add functions to `stacklens/backend/src/repositories/*` (parameterised queries only). Schema change? Use the `add-db-migration` skill.
3. **Adapter** – create `stacklens/frontend/src/app/api/<segments with [id]>/route.ts`:
   ```ts
   export const dynamic = 'force-dynamic';
   export { GET, PATCH } from '@stacklens/backend/http/<segments>';
   ```
4. **Types** – response shapes the UI consumes go in `packages/shared/src/api-types.ts`.
5. **Audit** – admin-relevant writes call `audit(user, 'thing.update', id, { … })` (from `repositories/account-repository`).
6. **Tests** – repository behaviour in `stacklens/backend/test/repositories.test.ts`.
7. Run the `verify-change` skill; hit the endpoint (`curl -i localhost:4300/api/…`) signed in and signed out to confirm 200/401/403.
