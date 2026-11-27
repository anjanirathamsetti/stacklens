# stacklens (frontend)

Next.js 16 App Router UI, React 19, Tailwind v4. Published as the `stacklens` npm CLI and the Docker image.

- `src/app/` holds routes only. Pages re-export from `src/features/<name>/`.
- `src/app/api/**/route.ts` are generated-style adapters: `export const dynamic = 'force-dynamic'` plus `export { GET } from '@stacklens/backend/http/…'`. No logic here.
- Server components get the user from `@/server/session` (`getCurrentUser`), never from the backend's request context.
- Shared, isomorphic code goes in `packages/shared` (`@stacklens/shared/<file>`), not `src/lib`.
- Dev server: port 4300, output in `.next.nosync` (cloud-sync safe). Don't run `next build` into `.next` while the dev server runs; use `NEXT_DIST_DIR`.
