# SDK conformance

Language-neutral checks that every StackLens SDK must pass.

| File | Role |
|---|---|
| `scenarios.json` | The scenarios (nested calls, errors, loop collapsing, logs, cross-service calls) and what the resulting trace must contain. |
| `check.mjs` | Validates a runner's output against `packages/contract/schema/trace.schema.json` and each scenario. |
| `node-tracer/run.mjs` | Reference runner for `@stacklens/node-tracer`. |
| `python-tracer/run.py` | Runner for `stacklens-python-tracer` (standard library only). |

```bash
npm run conformance:node
npm run conformance:python
# any language:
<runner> > results.json && node sdks/conformance/check.mjs results.json
```

A runner implements each scenario with its SDK's normal instrumentation, captures the exported traces in-process (no server needed), and prints `{ "<scenario name>": TraceRecord }` as JSON. Scenarios with a second service (`cross-service`) also print the callee's trace as `"<scenario name>.child"`.
