---
name: add-ui-page
description: Add a new page or major view to the StackLens UI (route, feature folder, sidebar entry, data fetching).
---

# Add a UI page

1. **Feature folder** – `stacklens/frontend/src/features/<name>/<name>-page.tsx` (client component unless it only renders static content) plus `components/` for private pieces.
2. **Route** – `stacklens/frontend/src/app/(app)/<name>/page.tsx`:
   ```tsx
   import type { Metadata } from 'next';

   export const metadata: Metadata = { title: '<Title>' };
   export { default } from '@/features/<name>/<name>-page';
   ```
   Admin-only pages go under `(app)/admin/` (the layout already enforces the admin role).
3. **Navigation** – add the entry to `src/components/layout/nav-config.ts` (rendered by `app-sidebar.tsx`) (keep the user menu limited to Profile, Admin, Sign out).
4. **Data** – fetch `/api/*`; add the endpoint with the `add-api-endpoint` skill. Keep filters in the URL via `src/lib/url-filters.ts` so views are shareable.
5. **UI** – reuse `src/components/ui` primitives and `data-display` (JSON viewer, badges, pagination). Handle empty, loading and error states. Check light + dark mode and a narrow viewport.
6. Run the `verify-change` skill, including the browser check.
