# stacklens

The StackLens server: trace collector and analyser UI for Node.js backends instrumented with [`@stacklens/tracer`](../../packages/tracer).

```bash
npx stacklens                  # http://localhost:4300
docker run -p 4300:4300 -v stacklens-data:/data stacklens
```

The UI has Overview (live KPIs and charts), Traces (call trees, flame graph, input/output per call), Errors, Incidents (ServiceNow) and Hotspots pages.

Configuration and deployment: [docs/deployment.md](../../docs/deployment.md).
