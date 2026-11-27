---
description: Conventions for the Next.js UI
paths:
  - "stacklens/frontend/**"
---

# Frontend rules

- `src/app/**/page.tsx` stays thin (metadata + re-export from `src/features/<name>`). `src/app/api/**/route.ts` only re-exports backend handlers and sets `dynamic = 'force-dynamic'`.
- Feature code in `src/features/<name>/` (`components/`, hooks, page). Reusable UI in `src/components/{ui,layout,charts,data-display}`.
- Server components read the user via `@/server/session`. Client components fetch `/api/*`.
- Filter state lives in the URL (`src/lib/url-filters.ts`). Anything read from `localStorage` must be hydration-safe (`useSyncExternalStore` with a server snapshot, or read after mount).
- Styling: Tailwind v4 with the theme tokens in `globals.css`; check both light and dark mode. No new UI libraries without asking.
- Dense data views: collapse long content, virtualise or paginate big lists, keep payloads small.
- Verify UI changes in the browser (see the `verify-change` skill) – not just typecheck.
