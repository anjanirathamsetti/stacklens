# SDK conformance

Language-neutral checks that every StackLens SDK must pass.

| File | Role |
|---|---|
| `scenarios.json` | The scenarios (nested calls, errors, loop collapsing, logs) and what the resulting trace must contain. |
| `check.mjs` | Validates a runner's output against `packages/contract/schema/trace.schema.json` and each scenario. |
| `node/run.mjs` | Reference runner for `@stacklens/node-tracer`. |

```bash
npm run conformance:node
# any language:
<runner> > results.json && node sdks/conformance/check.mjs results.json
```

A runner implements each scenario with its SDK's normal instrumentation, captures the exported traces in-process (no server needed), and prints `{ "<scenario name>": TraceRecord }` as JSON.
