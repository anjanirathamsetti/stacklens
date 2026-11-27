---
name: seed-test-data
description: Fill a StackLens server with realistic and heavy traces (deep call trees, loops, recursion, SQL, errors) for UI work or testing.
---

# Seed test data

The example apps produce real traces through the Node SDK.

```bash
npm run build:packages
npm run example:express          # :3001  (lab routes: loops, recursion, fan-out, big payloads)
npm run example:nest             # :3002  (TypeORM SQL, /orders/audit)
npm run seed                     # one pass of every heavy scenario, then exits
npm run traffic                  # or: continuous mixed traffic (Ctrl+C to stop)
```

- Point the apps at another server with `STACKLENS_ENDPOINT=http://localhost:<port>/api/ingest`.
- Point the traffic script at other app ports with `EXPRESS_URL` / `NEST_URL`.
- If the server requires an ingest key, create one in Admin → API keys and start the apps with `STACKLENS_API_KEY` set. Don't paste keys into chat or commit them.
- Scenarios live in `examples/node/express-basic/src/lab/` and `scripts/generate-traffic.mjs`; add new heavy shapes there.
