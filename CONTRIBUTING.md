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
