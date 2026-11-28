# SDKs

| Language | Path | Package | Status |
|---|---|---|---|
| Node.js / TypeScript | [`node-tracer/`](node-tracer) | `@stacklens/node-tracer` | stable |
| Python 3.9+ | [`python-tracer/`](python-tracer) | `stacklens-python-tracer` (import `stacklens`) | new: FastAPI/Starlette, Flask, Django, SQLAlchemy, Celery, requests/httpx/urllib3 |

Neither is published to a registry yet; install from this repository (see each README).

Every SDK speaks the [trace contract](../docs/contract.md) and passes the [conformance suite](conformance). To add a language, follow [docs/sdk-authoring.md](../docs/sdk-authoring.md).
