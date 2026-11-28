// Calls the NestJS example (billing-api). Both apps run StackLens, so each request here carries a
// W3C traceparent header and billing-api's call tree shows up under this call in the StackLens UI.
const http = require('http');

const BILLING_URL = process.env.BILLING_URL || 'http://localhost:3002';

class BillingClient {
  /** GET with the global fetch (undici). */
  async getInvoice(userId) {
    const res = await fetch(`${BILLING_URL}/orders/invoice/${userId}`, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      const e = new Error(`billing-api answered ${res.status}`);
      e.status = res.status === 404 ? 404 : 502;
      throw e;
    }
    return res.json();
  }

  /** POST with node:http – the same path axios takes in Node. */
  createOrder(userId, amount) {
    const body = JSON.stringify({ userId, amount });
    const url = new URL('/orders', BILLING_URL);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (d) => (data += d));
          res.on('end', () => {
            const parsed = data ? JSON.parse(data) : null;
            if (res.statusCode >= 400) {
              const e = new Error(parsed?.message || `billing-api answered ${res.statusCode}`);
              e.status = res.statusCode < 500 ? res.statusCode : 502;
              reject(e);
            } else resolve(parsed);
          });
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }
}

module.exports = new BillingClient();
