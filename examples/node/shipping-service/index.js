// A third-party-style shipping API with NO StackLens: no SDK, no traceparent handling, no
// x-stacklens-trace-id header. Callers that run StackLens still record every request they send it
// (method, URL, headers, body) and every response (status, headers, body), but there is no call
// graph for what happens in here – the StackLens UI says "Call graph not available".
const http = require('http');
const { URL } = require('url');

const RATES = { standard: 4.9, express: 12.5 };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-shipping-request-id': `req_${Date.now().toString(36)}`, ...headers });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    if (req.headers['x-api-key'] !== 'demo-shipping-key') return send(res, 401, { error: 'invalid api key' });

    // POST /quotes { zip, items: [{ sku, qty }], service } → price and ETA
    if (req.method === 'POST' && url.pathname === '/quotes') {
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return send(res, 400, { error: 'invalid json' });
      }
      if (!/^\d{5}$/.test(body.zip ?? '')) return send(res, 422, { error: 'zip must be 5 digits', field: 'zip' });
      if (body.zip === '00000') return send(res, 503, { error: 'carrier unavailable for this region' });
      const qty = (body.items ?? []).reduce((n, i) => n + (i.qty ?? 1), 0) || 1;
      const service = RATES[body.service] ? body.service : 'standard';
      const price = +(RATES[service] + qty * 0.75).toFixed(2);
      // a little latency, like a real carrier API
      return setTimeout(
        () => send(res, 200, { carrier: 'ParcelCo', service, price, currency: 'USD', etaDays: service === 'express' ? 1 : 4 }),
        15 + Math.random() * 25,
      );
    }

    // GET /labels/:id → a label streamed in chunks (text/plain)
    const label = /^\/labels\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && label) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      const lines = [`LABEL ${label[1]}`, 'FROM: StackLens Demo Store', 'TO: Ada Lovelace, 12 Example St', 'CARRIER: ParcelCo', 'END'];
      let i = 0;
      const tick = setInterval(() => {
        res.write(lines[i++] + '\n');
        if (i === lines.length) {
          clearInterval(tick);
          res.end();
        }
      }, 10);
      return;
    }
    send(res, 404, { error: 'not found' });
  });
});

const port = process.env.PORT || 3003;
server.listen(port, () => console.log(`shipping-service (no StackLens) on http://localhost:${port}`));
