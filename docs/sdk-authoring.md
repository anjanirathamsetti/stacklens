# Writing a StackLens SDK

StackLens records **every function call** in a request — arguments, return values, errors, logs — as a call tree. An SDK for a new language does the same and sends it in the [trace contract](contract.md) format.

## Where it goes

```
sdks/<language>-tracer/        e.g. sdks/python-tracer, sdks/go-tracer, sdks/java-tracer
  README.md             install + quick start
  src/ …                idiomatic package layout for that language
  conformance runner    prints { "<scenario>": TraceRecord } for sdks/conformance
examples/<language>/<framework>/   a runnable demo app
```

Use the language's own build tool and package registry (PyPI, Maven, Go modules…). Only the Node SDK is an npm workspace.

## What an SDK must do

1. **Entry point:** start a trace per incoming request (framework middleware) or job (`trace(name, fn)`); the root span has `parentId: null` and `kind: "http"` or `"job"`.
2. **Context propagation:** keep the current trace/span in the language's async-local mechanism (`contextvars` in Python, `context.Context` in Go, `ThreadLocal`/`ScopedValue` in Java) so nested calls find their parent.
3. **Instrumentation:** wrap controllers, services, repositories and DB calls. Name spans `ClassName.method`; infer `kind` from the class name (`*Controller` → controller, `*Service` → service, `*Repository` → repository) unless told otherwise.
4. **Capture:** copy arguments and the return value at call time, with the same limits as the Node SDK (`maxDepth`, `maxStringLength`, `maxArrayLength`, `maxObjectKeys`, `maxCaptureBytes`) and key-based redaction (`password`, `token`, `authorization`, …).
5. **Cardinality:** after `maxRepeatedCalls` identical sibling calls, fold the rest into one span with `collapsed`; stop recording after `maxSpansPerTrace` and set `truncated` / `droppedSpans`.
6. **Errors and logs:** set `status: "error"` and `error { name, message, stack }` on the span that threw; attach log lines to the current span.
7. **Export:** batch traces and `POST` them to `STACKLENS_ENDPOINT` (default `http://localhost:4300/api/ingest`) in the background, with `Authorization: Bearer <STACKLENS_API_KEY>` when set. Never block or fail the user's request.
8. **Options:** read the same names as the Node SDK (`application`, `project`, `environment`, `endpoint`, `apiKey`, `sampleRate`, `captureArgs`, `captureResults`, …), in the language's casing (Python: `sample_rate`), from code or `STACKLENS_*` environment variables.
9. **Identify yourself:** set `sdk: { name, version, language, runtime }` on every trace so the UI can show the language and use its idioms. Use the language's own type names in `argTypes`/`resultType` and its native stack-trace format.

## Proving it

Implement the scenarios in [`sdks/conformance/scenarios.json`](../sdks/conformance/scenarios.json) in a small runner, then:

```bash
<your runner> | node sdks/conformance/check.mjs -
```

The checker validates every trace against `trace.schema.json` and the scenario's expectations (call chain, kinds, args/results, errors, logs, loop collapsing). Add a CI job for the SDK, path-filtered to `sdks/<language>-tracer/**`, that runs its own tests and this check. See `sdks/conformance/node-tracer/run.mjs` for the reference runner and `sdks/conformance/python-tracer/run.py` for a second language (standard library only: a WSGI callee and `urllib.request`).

The Python SDK (`sdks/python-tracer`) is a worked example of porting the Node design: `contextvars` instead of `AsyncLocalStorage`, a background thread instead of timers for batching, framework middleware for ASGI/WSGI/Django, and library patches for the HTTP clients.
