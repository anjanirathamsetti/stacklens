---
name: add-sdk-language
description: Scaffold a StackLens SDK for a new programming language (Python, Go, Java, …) that matches the trace contract and passes conformance.
---

# Add an SDK for a new language

Read `docs/sdk-authoring.md` and `docs/contract.md` first. The Node SDK (`sdks/node-tracer`) is the reference implementation.

1. **Scaffold** `sdks/<language>-tracer/` with the language's normal layout and build tool (pyproject, go.mod, Maven/Gradle). Not an npm workspace. Name the folder and the published package `<language>-tracer` (e.g. `sdks/python-tracer`, published as `stacklens-python-tracer` on PyPI or the closest registry convention; npm uses `@stacklens/<language>-tracer`).
2. **Models** – generate or hand-write types from `packages/contract/schema/trace.schema.json`. Keep field names exactly as in the schema (camelCase on the wire).
3. **Core** – context propagation (contextvars / context.Context / ThreadLocal), span start/finish, bounded value capture with redaction, repeated-call collapsing (`maxRepeatedCalls`), span cap (`maxSpansPerTrace`), background batched HTTP exporter.
4. **Integrations** – one popular framework first (e.g. FastAPI/Django, net/http/Gin, Spring), plus its main DB layer for SQL capture.
5. **Conformance runner** – implement each scenario in `sdks/conformance/scenarios.json`, capture traces in-process, print `{ "<scenario>": TraceRecord }`; pass `node sdks/conformance/check.mjs -`.
6. **Example** – `examples/<language>/<framework>/` sending to `http://localhost:4300/api/ingest`.
7. **CI** – add a job to `.github/workflows/ci.yml` with a `sdk-<language>` path filter (`sdks/<language>-tracer/**`, `examples/<language>/**`, `packages/contract/**`, `sdks/conformance/**`) that runs the SDK's tests and the conformance check.
8. **Docs** – `sdks/<language>-tracer/README.md`, a row in `sdks/README.md`, and a line in the root README.
