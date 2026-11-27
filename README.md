# StackLens

**Call-tree tracing for Node.js backends (NestJS, Express, TypeORM), with a trace analyser UI.**

Add the SDK at your API's entry point. Every request is recorded as a tree of internal calls (controller → handler → service → repository → SQL), with each call's arguments, return value, inferred TypeScript type, errors and logs. You don't need any `console.log` statements.

```
┌─────────────┐   @stacklens/node-tracer    ┌───────────────────────────────┐
│  your API   │ ─────────────────────► │  stacklens server  :4300      │
│ Nest/Express│   POST /api/ingest     │  collector + UI (npx/Docker)  │
└─────────────┘                        └───────────────────────────────┘
```

## Quick start

**1. Run the server**

```bash
npx stacklens                                          # or:
docker run -p 4300:4300 -e DATABASE_URL=postgres://… stacklens   # or: npm run docker:up (includes PostgreSQL)
```

**2. Instrument your API**

```bash
npm install @stacklens/node-tracer
```

```ts
// NestJS + TypeORM (main.ts)
import { stacklens } from '@stacklens/node-tracer';
import * as typeorm from 'typeorm';

stacklens.init({ application: 'billing-api', project: 'payments' });
stacklens.instrumentTypeORM(typeorm);
const app = await NestFactory.create(AppModule);
stacklens.instrumentNest(app);
await app.listen(3000);
```

```js
// Express, plain JavaScript (index.js)
const { stacklens } = require('@stacklens/node-tracer');
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
stacklens/                         the StackLens app (one deployable: `npx stacklens` / Docker)
  frontend/     stacklens          Next.js UI + thin route adapters (`app/api/**/route.ts`)
  backend/      @stacklens/backend framework-agnostic core: HTTP handlers, auth, db, repositories, services
packages/
  contract/     @stacklens/types   wire contract (TS types + trace.schema.json), shared by every SDK and the server
  shared/       @stacklens/shared  isomorphic helpers used by frontend and backend (span tree, formatters, API types)
sdks/
  node/         @stacklens/node-tracer  Node.js SDK – ESM + CJS, typed, tested
  conformance/                     language-neutral scenarios + checker every SDK must pass
examples/
  node/express-basic/              plain JS Express API
  node/nestjs-typeorm/             NestJS 11 + TypeORM API
deploy/         docker/Dockerfile · docker-compose.yml (with PostgreSQL)
docs/           architecture · deployment · contract · sdk-authoring
scripts/        dev-guard.mjs · generate-traffic.mjs
.claude/        rules and skills for AI-assisted changes (see CLAUDE.md)
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
| `npm run build` | Build `@stacklens/types`, `@stacklens/node-tracer` and the server |
| `npm run lint` / `typecheck` / `test` / `format` | Quality gates (also run in CI) |
| `npm start` | Run the built server via its CLI |
| `npm run docker:build` / `docker:up` | Build the Docker image / run it with PostgreSQL |
| `npm run conformance:node` | Check the Node SDK against the cross-language conformance suite |

## Documentation

- [SDK reference](sdks/node-tracer/README.md)
- [Architecture & performance](docs/architecture.md)
- [Deployment & configuration](docs/deployment.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
