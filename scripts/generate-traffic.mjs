#!/usr/bin/env node
/**
 * Sends continuous, realistic traffic to both example apps so the StackLens UI has live data.
 *
 *   npm run traffic            # ~2 requests/second
 *   npm run traffic -- 10      # ~10 requests/second
 */
const rps = Number(process.argv[2] || 2);
const users = ['u_1001', 'u_1002', 'u_1003', 'u_2001', 'u_2002', 'u_3007'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const scenarios = [
  // [weight, method, url, body?]
  [6, 'GET', 'http://localhost:3001/api/users/1'],
  [3, 'GET', 'http://localhost:3001/api/users/2'],
  [1, 'GET', 'http://localhost:3001/api/users/99'],
  [5, 'GET', 'http://localhost:3001/api/orders?userId=1'],
  [2, 'GET', 'http://localhost:3001/api/orders?userId=1&status=paid'],
  [
    3,
    'POST',
    'http://localhost:3001/api/orders',
    () => ({ userId: pick([1, 2]), items: [{ sku: 'kb-01', price: 49.5, qty: 1 + Math.floor(Math.random() * 3) }] }),
  ],
  [1, 'GET', 'http://localhost:3001/api/orders/2/fail'],
  [5, 'GET', 'http://localhost:3002/orders/invoice/1'],
  [3, 'GET', 'http://localhost:3002/orders/invoice/2'],
  [3, 'GET', 'http://localhost:3002/orders/stats'],
  [2, 'POST', 'http://localhost:3002/orders', () => ({ userId: pick([1, 2]), amount: +(Math.random() * 90 + 5).toFixed(2) })],
  [1, 'POST', 'http://localhost:3002/orders', () => ({ userId: 1, amount: -1 })],
  [1, 'GET', 'http://localhost:3002/users/42'],
];
const total = scenarios.reduce((a, s) => a + s[0], 0);

function next() {
  let r = Math.random() * total;
  for (const s of scenarios) if ((r -= s[0]) <= 0) return s;
  return scenarios[0];
}

let sent = 0;
setInterval(() => {
  const [, method, url, body] = next();
  const user = pick(users);
  fetch(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${user}`, 'x-user-id': user },
    body: body ? JSON.stringify(body()) : undefined,
  })
    .then(() => {
      if (++sent % 50 === 0) console.log(`sent ${sent} requests`);
    })
    .catch((e) => console.error(method, url, e.message));
}, 1000 / rps);
console.log(`sending ~${rps} req/s to the example apps (Ctrl+C to stop)`);
