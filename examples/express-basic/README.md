# Example: Express (plain JavaScript)

An orders API (controllers → handlers → services → repositories over a fake async DB) traced with zero changes to the business code:

- `stacklens.autoInstrument()` wraps everything exported from `src/` via a `require` hook.
- `stacklens.express()` creates one trace per request.
- A fake auth middleware sets `req.user`, which becomes the trace's user id.

```bash
npm run example:express   # http://localhost:3001
curl localhost:3001/api/users/1
curl localhost:3001/api/orders/2/fail   # a traced 500
```
