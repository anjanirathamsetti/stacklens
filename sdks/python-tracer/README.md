# stacklens-python-tracer

Call-tree tracing for Python backends: every function call in a request or job (arguments, return value, exception, log lines, SQL, outgoing HTTP calls) recorded as a tree and sent to the [StackLens](../../README.md) server.

- Python 3.9+. The core uses only the standard library; integrations import their framework when you call them.
- FastAPI / Starlette (any ASGI app), Flask (any WSGI app), Django, SQLAlchemy, Celery, `requests`, `httpx`, `urllib3`, `urllib.request`.
- `asyncio`-correct: the current call travels in a `contextvar`, so `gather`-ed tasks, `create_task` and `to_thread` get the right parent.
- Never raises into your app or blocks it: values are captured with limits, export runs in a background thread, failures are only reported (once) on stderr.

> [!NOTE]
> Not on PyPI yet. Install it from a checkout of this repository: `pip install -e /path/to/stacklens/sdks/python-tracer` (add extras such as `[fastapi,sqlalchemy]` only if you want pip to pull those libraries in too).

## FastAPI + SQLAlchemy

```python
import stacklens
from stacklens.integrations.fastapi import instrument_fastapi
from stacklens.integrations.sqlalchemy import instrument_sqlalchemy

stacklens.init(application="catalog-api", project="storefront")
instrument_sqlalchemy()                      # a SQL.query span per statement, every engine

from app import repositories, services      # your code
stacklens.instrument_module(repositories)    # every class and function defined there
stacklens.instrument_module(services)

app = FastAPI()
app.include_router(products.router)
instrument_fastapi(app)                      # one trace per request + a span per route handler
```

Route handlers become `controller` spans (`products.get_product`) whose arguments are the values FastAPI resolved: path and query parameters, body models, dependencies. Instrument modules **before** the routes import them if you want `Depends()` functions traced (FastAPI keeps a reference to the function it was given). Any other ASGI app: `app = StackLensASGIMiddleware(app)` from `stacklens.integrations.asgi`.

## Flask

```python
from stacklens.integrations.flask import instrument_flask

stacklens.init(application="inventory-api")
app = Flask(__name__)
app.register_blueprint(stock)
instrument_flask(app)        # trace per request, route template, bodies, user, a span per view
```

The exception behind a 500 that Flask handles is recorded on the request's root span. `g.user` and flask-login's `current_user` are used as the trace's user. Other WSGI apps: `app = StackLensMiddleware(app)` from `stacklens.integrations.wsgi`.

## Django

```python
# settings.py – first, so it sees the whole request
MIDDLEWARE = ["stacklens.integrations.django.StackLensMiddleware", *MIDDLEWARE]

# wsgi.py / asgi.py (or AppConfig.ready)
import stacklens
stacklens.init(application="accounts-api")
```

Traces are named after the URL pattern (`GET /accounts/<int:pk>/`). Function views and the `get`/`post`/… methods of class-based views become `controller` spans, and every statement the ORM runs becomes a `SQL.query` span (through `connection.execute_wrapper`). Works under WSGI and ASGI. The user comes from `request.user`.

## Celery

```python
from stacklens.integrations.celery import instrument_celery

stacklens.init(application="notifications-worker")
instrument_celery()          # in the worker, and in every process that enqueues tasks
```

Each task run is a trace (kind `job`) with a span for the task function (arguments, return value, exception; retries are logged). `delay()` / `apply_async()` inside a trace records an `enqueue <task>` span and sends `traceparent` in the message headers, so the worker's trace shows "Called by …" and links back. A task run eagerly inside a request is a child span instead.

## Your own code

```python
@stacklens.traced                         # a function or method
def price(order): ...

@stacklens.traced(name="Billing.total", kind="service")
def total(items): ...

@stacklens.traced                         # a whole class: every method (instance, class, static)
class InvoiceService: ...

stacklens.instrument_class(PaymentGateway, exclude=["health"])
stacklens.instrument_module(app.services)  # functions → "services.create_order", classes → "OrderService.place"
tax = stacklens.wrap(compute_tax, "Tax.compute")

with stacklens.trace("nightly-report"):    # a root trace outside HTTP (also `async with`, or @stacklens.trace("…"))
    build_report()
with stacklens.trace("consume", headers=message.headers):  # link a queue consumer to the producer's traceparent
    handle(message)

stacklens.log("cache miss", {"key": key})  # a log line (with data) on the current call
stacklens.set_attributes(region="eu")      # custom attributes on the current call
stacklens.set_user(user.id)                # the trace's end user
stacklens.current_trace_id()               # e.g. for error responses
stacklens.propagation_headers()            # traceparent/tracestate for transports StackLens doesn't patch
stacklens.flush()                          # send queued traces now (scripts, tests); also runs at exit
```

Span names are `Class.method` (the runtime class, so an inherited `BaseRepository.find` shows as `UserRepository.find`) or `<module>.<function>`. The kind comes from the class or module name: `*Controller`, `*View`, `views`, `routes` → controller; `*Handler`, `tasks` → handler; `*Service`, `*Client`, `services` → service; `*Repository`, `*Repo`, `models`, `crud` → repository; otherwise `function` (or `service` for classes). `logging` records emitted inside a traced call are attached to it (your logger levels still apply).

## API

| | |
|---|---|
| `init(**options)` | Configure (call again to change options). Patches the installed HTTP clients. |
| `traced` | Decorator for functions, methods and classes. |
| `instrument_class(cls, name=, kind=, include=, exclude=)` · `instrument_module(mod, …)` · `instrument(obj)` · `wrap(fn, name, kind)` | Instrument existing code. |
| `trace(name, fn=None, *args, headers=, attributes=)` | Root trace for jobs and scripts: context manager, decorator, or call. |
| `log` · `set_attributes` · `set_user` · `current_trace_id` · `propagation_headers` · `flush` | Inside a traced call. |
| `integrations.fastapi.instrument_fastapi` · `.asgi.StackLensASGIMiddleware` | FastAPI / Starlette / any ASGI app. |
| `integrations.flask.instrument_flask` · `.wsgi.StackLensMiddleware` | Flask / any WSGI app. |
| `integrations.django.StackLensMiddleware` | Django (sync and async). |
| `integrations.sqlalchemy.instrument_sqlalchemy(engine=None)` | SQL spans (sync and asyncio engines). |
| `integrations.celery.instrument_celery()` | Celery tasks and producers. |

## Options

The Node SDK's options in snake_case (camelCase spellings are accepted too). Environment variables apply when an option isn't passed.

| Option | Env | Default |
|---|---|---|
| `application` (alias `service_name`) | `STACKLENS_APP` | `[project] name` in `./pyproject.toml`, else the script or folder name |
| `project` | `STACKLENS_PROJECT` | `default` |
| `environment` | `STACKLENS_ENV` | `development` |
| `endpoint` | `STACKLENS_ENDPOINT` | `http://localhost:4300/api/ingest` |
| `api_key` (Admin → API keys) | `STACKLENS_API_KEY` | none |
| `enabled` | `STACKLENS_ENABLED` | `True` |
| `sample_rate` (0–1 of requests) | `STACKLENS_SAMPLE_RATE` | `1` |
| `capture_args` · `capture_results` · `infer_types` | | `True` |
| `capture_logging` (Node: `captureConsole`) | | `True` |
| `max_spans_per_trace` | | `2000` |
| `max_repeated_calls` (0 = never collapse) | | `10` |
| `max_capture_bytes` (per trace) | | `1_000_000` |
| `max_logs_per_span` | | `50` |
| `max_depth` · `max_string_length` · `max_array_length` · `max_object_keys` | | `6` · `2000` · `30` · `50` |
| `redact_keys` (strings match exactly, ignoring case; compiled patterns search) | | password, secret, token, authorization, cookie, set-cookie, api key, cvv, card number, ssn |
| `ignore_paths` | | `/favicon.ico`, `/health…` |
| `ignore_methods` | | none |
| `capture_outbound` | `STACKLENS_CAPTURE_OUTBOUND` | `True` |
| `propagate` | `STACKLENS_PROPAGATE` | `True` |
| `propagate_to` | | every host |
| `get_user_id(request)` | | `request.state.user` / `scope["user"]` / Django `request.user` (`id`, `user_id`, `pk`, `sub`), else the `x-user-id` header |
| `settle_ms` (wait before export, for fire-and-forget tasks) | | `30` |
| `debug` (report export problems on stderr) | `STACKLENS_DEBUG` | `True` |
| `exporter` (callable that receives each trace dict instead of HTTP) | | none |
| `batch_size` · `flush_interval_ms` | | `25` · `250` |

### Calls to other services

`requests` (`Session.send`), `httpx` (`Client.send`, `AsyncClient.send`), `urllib3` (`HTTPConnectionPool.urlopen`) and `urllib.request` are patched by `init()`. Each call inside a trace is a span of kind `http` named `GET host/path` (ids in the path become `:id`), with the request (method, URL with secret query values redacted, headers, body) as its argument and the response (`statusCode`, headers, body) as its result. Bodies over 64 KB are cut, binary bodies are summarised, streamed responses (`stream=True`, `preload_content=False`) keep their bodies unread; `urllib.request` records status and headers only, since the body is read after the call. A 5xx answer marks the call failed. A library calling another (`requests` → `urllib3`) is recorded once.

The SDK sends `traceparent: 00-<trace id>-<span id>-01` and `tracestate: stacklens=<application>`; an instrumented callee records them as its trace's `parent` and answers with `x-stacklens-trace-id`, which becomes `outbound.childTraceId`. Set `propagate_to=["billing.internal", ".svc.cluster.local", re.compile(r"^10\.")]` to keep the headers away from third parties, or `propagate=False`. Incoming `traceparent` headers are read by every server integration.

### Loops and large requests

The first `max_repeated_calls` calls of a function under the same parent get their own span; later ones are folded into one span with `collapsed: {count, totalDuration, minDuration, maxDuration, errors}` (the first three failures stay individual, with their arguments). N+1 queries collapse the same way. Past `max_spans_per_trace` spans the trace is marked `truncated`; past `max_capture_bytes` later calls keep timing and errors but not values.

### How values look

Arguments and return values are copied when the call happens, as JSON the UI renders, with Python type names: `str`, `int`, `list[Order]`, `dict[int, str]`, `Order { id: int; total: Decimal }`. Dataclasses, pydantic models, named tuples, ORM rows (loaded columns only; no lazy loads are triggered) and plain objects keep their fields and class name; `Decimal`, `UUID`, `datetime`, enums, bytes, sets and exceptions have readable forms; sessions, engines, sockets and framework request objects are summarised; generators and coroutines are never consumed. `self` is not recorded. Exceptions keep their Python traceback (chained exceptions included, the tracer's own frames removed) and an HTTP status when they carry one (`status_code`, `status`, `code`).

## How it works

`init()` resolves options and patches the HTTP clients. A server integration creates a trace for each request and puts `(trace, current span)` in a `contextvars.ContextVar`; each wrapped function reads it, starts a child span, sets itself as current while it runs (sync, async, or generator) and records the outcome. asyncio tasks copy the context when they're created; Starlette's thread pool and `asyncio.to_thread` copy it into threads (for your own `ThreadPoolExecutor`, submit `contextvars.copy_context().run`). Finished traces wait `settle_ms`, are sealed and JSON-encoded by a daemon thread and posted in batches; `flush()` runs at exit, and the thread restarts after `fork()` (gunicorn, Celery prefork).

Tests: `pip install -e ".[test]" && pytest` in this folder; conformance: `npm run conformance:python` from the repo root.
