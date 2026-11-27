# SDKs

One folder per language (`sdks/node-tracer`, later `sdks/python-tracer`, `sdks/go-tracer`, …). Each SDK must emit traces valid against `packages/contract/schema/trace.schema.json` and pass `sdks/conformance`.

- Node SDK hot path is `sdks/node-tracer/src/serialization/capture.ts` and `core/tracer.ts`; measure before/after when touching them.
- Never let tracing throw into or block the user's code; export is batched and background.
- Follow the `add-sdk-language` skill for a new language.
