# Deploying the StackLens server

The server is one process: collector API + UI on a single port (default `4300`).

## From source

StackLens isn't published to npm yet (the `stacklens` name on npm belongs to an unrelated package).

```bash
npm install && npm run build
npm start                                    # http://localhost:4300
node stacklens/frontend/bin/stacklens.mjs --port 8080 --data-dir ./data
```

## Docker

```bash
docker build -f deploy/docker/Dockerfile -t stacklens .
docker run -p 4300:4300 -e DATABASE_URL=postgres://user:pass@db:5432/stacklens stacklens   # production
docker run -p 4300:4300 -v stacklens-data:/data stacklens                                   # embedded PostgreSQL
```

`npm run docker:up` (`docker compose -f deploy/docker-compose.yml up --build`) starts StackLens together with PostgreSQL 17.

## Database

StackLens stores everything in PostgreSQL: traces, error events, incidents and user settings.

- **External server (recommended for production):** set `DATABASE_URL`. StackLens creates its tables on first start; migrations are applied automatically under an advisory lock. Any PostgreSQL 14+ works (RDS, Cloud SQL, Azure, Neon, Supabase…). Use `STACKLENS_DB_SSL=require` for managed databases.
- **Embedded:** without `DATABASE_URL`, an embedded PostgreSQL (PGlite) keeps data in `STACKLENS_DATA_DIR/pg`. It's fine for a single developer, but use a real server for teams and production.
- **Sizing:** a call tree is a few KB of `jsonb`. With the defaults (3k healthy + 2k error call trees, 100k summaries, 30 days), expect well under 1 GB.

The image runs as a non-root user, keeps data in the `/data` volume, and has a `HEALTHCHECK` on `GET /api/health`.

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` / `HOSTNAME` | `4300` / `0.0.0.0` | Listen address |
| `DATABASE_URL` | – (embedded) | PostgreSQL connection string |
| `STACKLENS_DB_POOL_MAX` | `10` | Connection pool size |
| `STACKLENS_DB_SSL` | – | `require` / `true` / `no-verify` |
| `STACKLENS_RETENTION_DAYS` | `30` | Delete summaries older than this |
| `STACKLENS_DATA_DIR` | `~/.stacklens/data` (`/data` in Docker) | Embedded database folder |
| `STACKLENS_MAX_TRACES` | `3000` | Healthy call trees in memory |
| `STACKLENS_MAX_ERROR_TRACES` | `2000` | Extra budget for traces with errors |
| `STACKLENS_MAX_SUMMARIES` | `100000` | Request summaries for metrics |
| `STACKLENS_PUBLIC_URL` | request origin | Base URL used in incident links; `https://` also marks session cookies `Secure` |
| `STACKLENS_ADMIN_EMAIL` / `STACKLENS_ADMIN_PASSWORD` | – | Creates the first admin at startup when no account exists |
| `STACKLENS_TRUST_PROXY` | off | Set to `1` behind a reverse proxy that overwrites `X-Forwarded-For`, so sign-in rate limits and the audit log use the real client address |
| `STACKLENS_AI_API_KEY` | – | Key for the AI provider chosen in Admin → AI assistant |
| `SERVICENOW_INSTANCE`, `SERVICENOW_USERNAME`/`SERVICENOW_PASSWORD` or `SERVICENOW_TOKEN` | – | Enables real ServiceNow incidents |
| `SERVICENOW_ASSIGNMENT_GROUP`, `SERVICENOW_CALLER_ID`, `SERVICENOW_CATEGORY`, `SERVICENOW_CLOSE_CODE` | – | Incident defaults |

See [`stacklens/frontend/.env.example`](../stacklens/frontend/.env.example).

## Pointing apps at it

Set `STACKLENS_ENDPOINT=http://<server>:4300/api/ingest` in each instrumented app, or pass `endpoint` to `stacklens.init()`.

If an admin has turned on **Require an API key** (Admin → API keys), also set `STACKLENS_API_KEY` (or pass `apiKey`). The tracer sends it as `Authorization: Bearer slk_…`.

## Accounts and roles

- **First run:** the first visitor creates the admin account at `/welcome`. On a server others can reach, set `STACKLENS_ADMIN_EMAIL` and `STACKLENS_ADMIN_PASSWORD` instead, so nobody else can claim it first.
- **Adding people:** admins add users in Admin → Users and hand over the one-time password shown there. StackLens doesn't send email. New users choose their own password at first sign-in.
- **Roles:**
  - **Viewer** can read everything.
  - **Member** can also create saved views, SLOs and incidents.
  - **Admin** can also manage users, API keys and team settings (AI, MCP, security, data, digest delivery).
- **Security:**
  - Passwords are hashed with scrypt.
  - Sessions are random tokens stored only as SHA-256 hashes, in an `HttpOnly`, `SameSite=Lax` cookie.
  - Sign-in is rate limited.
  - Cross-site writes are rejected.
  - Admin actions and sign-ins are recorded in Admin → Audit log.

## Notes

- **Replicas:** with an external PostgreSQL you can run several replicas behind a load balancer. Live updates fan out through LISTEN/NOTIFY and retention runs on one replica at a time. The embedded database supports a single instance only. Sign-in rate limits are kept per replica.
- **TLS:** serve StackLens over HTTPS in production (behind your ingress or a reverse proxy that sets `X-Forwarded-Proto`), so session cookies are only sent over TLS.
