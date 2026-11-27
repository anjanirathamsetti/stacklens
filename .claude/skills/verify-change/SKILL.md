---
name: verify-change
description: Verify a StackLens change end to end (typecheck, lint, tests, build, conformance, browser check on a throwaway database) before reporting it done.
---

# Verify a change

Run what the change touches; when unsure, run all of it.

```bash
npm run build -w @stacklens/types        # contract first: others typecheck against its dist
npm run typecheck                        # all workspaces
npm run lint                             # 0 errors (warnings in older files are known)
npm test                                 # contract, shared, SDK, backend
npm run conformance:node                 # SDK or contract changes
npm run build                            # production build (don't run while `npm run dev` uses the same distDir)
```

## Browser check (UI or API changes)

Never use the user's real data dir. Start a throwaway server:

```bash
STACKLENS_DATA_DIR=<scratch dir> NEXT_DIST_DIR=.next-test npx next dev -p 4310   # from stacklens/frontend
```

1. Create the first admin on `/welcome`, sign in.
2. Seed data with the `seed-test-data` skill (point traffic at 4310 or ingest directly).
3. Visit the changed pages; check the console for errors and hydration warnings; check light and dark mode.
4. For API changes, confirm 401 signed out and 403 for a too-low role.
5. Stop the server and delete the scratch dir afterwards.

Report what ran, what passed, and anything not verified.
