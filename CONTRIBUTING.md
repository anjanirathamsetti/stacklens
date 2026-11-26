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
- **Server app layout:** route files in `app/` stay thin. Page logic lives in `features/<name>/`, and anything importing Node APIs or secrets goes in `server/` (guarded by `server-only`).
- **Config:** server configuration is read only in `apps/server/src/server/env.ts`.
- **Wire format:** changes to `@stacklens/types` must be backwards compatible within a major version.
- **Comments:** explain *why*, not *what*. Public SDK APIs carry TSDoc.

## Cloud-synced folders (iCloud, Dropbox, OneDrive)

Keep the repo out of synced folders such as an iCloud-synced `~/Desktop` or `~/Documents`. Sync clients upload build output while it is
being written and leave conflict copies (`BUILD_ID 2`, `src/lib 2`). That breaks the dev server's live reload, so pages reload in a loop.

If you can't move it, two safeguards apply. `next dev` writes its output to `apps/server/.next.nosync`, which iCloud skips (set in
`next.config.ts`). And `npm run dev` runs `scripts/dev-guard.mjs` first, which:

- flags `.next`, `node_modules` and `dist` with `com.apple.fileprovider.ignore#P` so iCloud never syncs them,
- removes empty conflict-copy folders, and
- prints a warning naming the sync provider.
