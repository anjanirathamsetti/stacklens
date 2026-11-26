# StackLens

**Call-tree tracing for Node.js backends (NestJS, Express, TypeORM), with a trace analyser UI.**

Add the SDK at your API's entry point. Every request is recorded as a tree of internal calls (controller → handler → service → repository → SQL), with each call's arguments, return value, inferred TypeScript type, errors and logs. You don't need any `console.log` statements.

```
┌─────────────┐   @stacklens/tracer    ┌───────────────────────────────┐
│  your API   │ ─────────────────────► │  stacklens server  :4300      │
│ Nest/Express│   POST /api/ingest     │  collector + UI (npx/Docker)  │
└─────────────┘                        └───────────────────────────────┘
```

## Quick start

**1. Run the server**

```bash
npx stacklens                                          # or:
docker run -p 4300:4300 -e DATABASE_URL=postgres://… stacklens   # or: docker compose up (includes PostgreSQL)
```

**2. Instrument your API**

```bash
npm install @stacklens/tracer
```

```ts
// NestJS + TypeORM (main.ts)
import { stacklens } from '@stacklens/tracer';
import * as typeorm from 'typeorm';

stacklens.init({ application: 'billing-api', project: 'payments' });
stacklens.instrumentTypeORM(typeorm);
const app = await NestFactory.create(AppModule);
stacklens.instrumentNest(app);
await app.listen(3000);
```

```js
// Express, plain JavaScript (index.js)
const { stacklens } = require('@stacklens/tracer');
stacklens.init({ application: 'orders-api' });
stacklens.autoInstrument({ include: [__dirname + '/src/'] });
const app = express();
app.use(stacklens.express());
```

**3. Open http://localhost:4300**

On first run you create the admin account. Then add teammates in **Admin → Users**.

## Features

- **Traces:** sortable, paginated request log with a detail panel (timings, request details, input, response, errors, slowest calls). The full call tree has a waterfall, flame graph and per-call Input/Output inspector.
- **Overview:** live KPIs, request, latency, status-code and error-rate charts (drag to zoom), time by layer, top endpoints and users.
- **Errors:** exceptions grouped by where they were thrown. Client (4xx) and server errors are told apart.
- **Incidents:** ServiceNow tickets linked to error groups, with regression detection. A local demo mode works without an instance.
- **Hotspots:** every function aggregated by calls, latency and self time.
- **Filters:** project, application, environment, user, and a CloudWatch-style time picker. All filter state lives in the URL. Saved views and share links keep them handy.
- **SLOs and daily digest:** per-route latency and availability objectives with error budgets, and a daily summary that can post to Slack.
- **Accounts and Admin:** sign-in with admin, member and viewer roles. The Admin area manages users, ingest API keys, security, team settings (AI, MCP, integrations, data) and an audit log.
- **PostgreSQL storage:** traces, errors, incidents and user settings live in PostgreSQL (set `DATABASE_URL`), or in an embedded PostgreSQL for zero-config local use. Live updates use LISTEN/NOTIFY, so it scales to several replicas.

## Repository layout

```
packages/
  types/        @stacklens/types   shared trace contract (SDK ⇄ server)
  tracer/       @stacklens/tracer  the SDK – ESM + CJS, typed, tested
apps/
  server/       stacklens          collector API + UI (Next.js), `npx stacklens` / Docker
examples/
  express-basic/                   plain JS Express API
  nestjs-typeorm/                  NestJS 11 + TypeORM API
docker/         Dockerfile (standalone, non-root, healthcheck)
docs/           architecture.md · deployment.md
scripts/        generate-traffic.mjs
```

## Development

```bash
npm install
npm run dev                # packages + server on :4300 (hot reload)
npm run example:express    # :3001
npm run example:nest       # :3002
npm run traffic            # optional live traffic
```

| Command | |
|---|---|
| `npm run build` | Build `@stacklens/types`, `@stacklens/tracer` and the server |
| `npm run lint` / `typecheck` / `test` / `format` | Quality gates (also run in CI) |
| `npm start` | Run the built server via its CLI |
| `npm run docker:build` | Build the Docker image |

## Documentation

- [SDK reference](packages/tracer/README.md)
- [Architecture & performance](docs/architecture.md)
- [Deployment & configuration](docs/deployment.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
