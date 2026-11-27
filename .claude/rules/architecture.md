---
description: Repository structure and dependency direction for all StackLens code
---

# Architecture rules

- Dependency direction is one-way: `stacklens/frontend → stacklens/backend → packages/shared → packages/contract`, and `sdks/* → packages/contract`. Nothing imports the frontend; the backend never imports the frontend; SDKs never import app code.
- Put code where its consumers are:
  - used only by the UI → `stacklens/frontend/src`
  - server-only (db, auth, secrets, Node APIs) → `stacklens/backend/src`
  - pure and needed by both UI and backend → `packages/shared/src`
  - crosses the network between SDK and server → `packages/contract`
- Workspace packages export TypeScript sources (`"exports": { "./*": "./src/*.ts" }`); import them by package path, e.g. `@stacklens/shared/span-tree`, `@stacklens/backend/repositories/trace-repository`.
- New languages: `sdks/<language>-tracer` (folder and package named `<language>-tracer`, e.g. `node-tracer`, `python-tracer`) and `examples/<language>/<framework>`; never add language-specific code to the app.
- Deploy artifacts stay in `deploy/`; repo tooling in `scripts/`; long-form docs in `docs/`.
- When moving files, use `git mv` and update: root `package.json` workspaces, `deploy/docker/Dockerfile`, `.github/workflows/ci.yml` path filters, `scripts/dev-guard.mjs`, and docs.
