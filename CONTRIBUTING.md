# Contributing

```bash
nvm use                 # Node 22.12+
npm install
npm run dev             # builds the packages, then runs the server at http://localhost:4300
npm run example:express # in another terminal
npm run traffic         # optional live traffic
```

Before opening a PR:

```bash
npm run format && npm run lint && npm run typecheck && npm test && npm run build
```

## Conventions

- **TypeScript:** strict mode everywhere (`tsconfig.base.json`). No `any` in public APIs.
- **File names:** kebab-case. React components are PascalCase exports in kebab-case files.
- **Layout:** see [docs/architecture.md](docs/architecture.md). UI in `stacklens/frontend`, server logic in `stacklens/backend` (no Next.js imports there), helpers used by both in `packages/shared`.
- **Frontend:** route files in `app/` stay thin. Page logic lives in `features/<name>/`. API routes are one-line re-exports of `@stacklens/backend/http/*`.
- **Config:** server configuration is read only in `stacklens/backend/src/env.ts`.
- **Wire format:** changes to `@stacklens/types` must be backwards compatible within a major version, and `packages/contract/schema/trace.schema.json` must change with them (a test enforces it). See [docs/contract.md](docs/contract.md).
- **SDKs:** new languages go in `sdks/<language>-tracer` and must pass `sdks/conformance`. See [docs/sdk-authoring.md](docs/sdk-authoring.md).
- **Comments:** explain *why*, not *what*. Public SDK APIs carry TSDoc.

## Cloud-synced folders (iCloud, Dropbox, OneDrive)

Keep the repo out of synced folders such as an iCloud-synced `~/Desktop` or `~/Documents`. Sync clients upload build output while it is
being written and leave conflict copies (`BUILD_ID 2`, `src/lib 2`). That breaks the dev server's live reload, so pages reload in a loop.

If you can't move it, two safeguards apply. `next dev` writes its output to `stacklens/frontend/.next.nosync`, which iCloud skips (set in
`next.config.ts`). And `npm run dev` runs `scripts/dev-guard.mjs` first, which:

- flags `.next`, `node_modules` and `dist` with `com.apple.fileprovider.ignore#P` so iCloud never syncs them,
- removes empty conflict-copy folders, and
- prints a warning naming the sync provider.
