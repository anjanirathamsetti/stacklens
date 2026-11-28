---
description: Rules for the wire contract and every language SDK
paths:
  - "packages/contract/**"
  - "sdks/**"
  - "examples/**"
---

# Contract and SDK rules

- The contract is additive within a major version: new fields are optional; never rename, retype or remove one.
- Change `packages/contract/src/index.ts` and `schema/trace.schema.json` together (`npm test -w @stacklens/types` checks they match). Rebuild with `npm run build -w @stacklens/types` before typechecking dependants.
- Behaviour every SDK must share belongs in `sdks/conformance/scenarios.json`; update the Node runner and run `npm run conformance:node`.
- SDKs must never throw into, slow down noticeably, or block the instrumented app. Capture is bounded (depth, length, bytes); export is batched and backgrounded; failures are swallowed (logged only with `debug`).
- Redact secrets by key before anything leaves the process.
- The core purpose is function-by-function args and return values: don't add sampling or capture shortcuts that drop them by default.
- Node SDK: ESM + CJS via tsup; keep `sdks/node-tracer/README.md` in sync with public API changes.
- Python SDK: stdlib-only core, Python 3.9+, integrations import their library lazily; keep `sdks/python-tracer/README.md` in sync and run `npm run test:python` and `npm run conformance:python`.
