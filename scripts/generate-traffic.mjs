#!/usr/bin/env node
/**
 * Sends realistic traffic to both example apps so the StackLens UI has data.
 *
 *   npm run traffic                 # continuous, ~2 requests/second
 *   npm run traffic -- 10           # continuous, ~10 requests/second
 *   npm run seed                    # one batch of heavy requests (big call trees, loops), then exit
 *   npm run seed -- 3               # the seed batch three times
 *
 * Heavy scenarios (src/lab in the Express example, /orders/audit in the NestJS example) produce
 * thousands of internal calls per request: nested loops, N+1 queries, recursion and parallel
 * fan-out, with some failures inside the loops.
 */
const args = process.argv.slice(2);
const seedAt = args.indexOf('--seed');
const seedRounds = seedAt >= 0 ? Number(args[seedAt + 1]) || 1 : 0;
const rps = seedAt >= 0 ? 0 : Number(args[0]) || 2;

const EXPRESS = process.env.EXPRESS_URL ?? 'http://localhost:3001';
const NEST = process.env.NEST_URL ?? 'http://localhost:3002';
const users = ['u_1001', 'u_1002', 'u_1003', 'u_2001', 'u_2002', 'u_3007'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/** Big call trees: [weight, method, url (string or fn), body?] */
const heavy = [
  // nested loops: batches → items → validate / price / currency / write (~25k calls)
  [1, 'GET', () => `${EXPRESS}/api/lab/catalog-sync?batches=${rand(10, 30)}&size=${pick([100, 250, 500])}`],
  // the 10,000-item report: helper + repository per item, with a few failures
  [1, 'GET', () => `${EXPRESS}/api/orders/report?items=${pick([2000, 10000, 20000])}`],
  // parallel fan-out: Promise.all over friends, N+1 author lookups per post
  [1, 'GET', () => `${EXPRESS}/api/lab/feed/${rand(1, 50)}?friends=${pick([10, 40, 80])}`],
  // recursion: category tree (depth 6 shows the maxSpansPerTrace backstop)
  [1, 'GET', () => `${EXPRESS}/api/lab/categories/tree?depth=${pick([3, 4, 5, 6])}&breadth=${pick([3, 4])}`],
  // deep call chain repeated per customer, console output in the loop
  [1, 'POST', () => `${EXPRESS}/api/lab/invoices/run?customers=${pick([100, 300, 1000])}`],
  // real SQL N+1 through TypeORM
  [1, 'GET', () => `${NEST}/orders/audit?limit=${pick([50, 150, 300])}`],
];

const normal = [
  [6, 'GET', `${EXPRESS}/api/users/1`],
  [3, 'GET', `${EXPRESS}/api/users/2`],
  [1, 'GET', `${EXPRESS}/api/users/99`],
  [5, 'GET', `${EXPRESS}/api/orders?userId=1`],
  [2, 'GET', `${EXPRESS}/api/orders?userId=1&status=paid`],
  [
    3,
    'POST',
    `${EXPRESS}/api/orders`,
    () => ({ userId: pick([1, 2]), items: [{ sku: 'kb-01', price: 49.5, qty: 1 + Math.floor(Math.random() * 3) }] }),
  ],
  [1, 'GET', `${EXPRESS}/api/orders/2/fail`],
  // cross-service: orders-api → billing-api (fetch + node:http), linked call trees
  [3, 'POST', `${EXPRESS}/api/checkout/1`, () => ({ items: [{ sku: 'kb-01', price: 49.5, qty: 1 + Math.floor(Math.random() * 3) }] })],
  [1, 'POST', `${EXPRESS}/api/checkout/2`],
  [1, 'POST', `${EXPRESS}/api/checkout/42`],
  [5, 'GET', `${NEST}/orders/invoice/1`],
  [3, 'GET', `${NEST}/orders/invoice/2`],
  [3, 'GET', `${NEST}/orders/stats`],
  [2, 'POST', `${NEST}/orders`, () => ({ userId: pick([1, 2]), amount: +(Math.random() * 90 + 5).toFixed(2) })],
  [1, 'POST', `${NEST}/orders`, () => ({ userId: 1, amount: -1 })],
  [1, 'GET', `${NEST}/users/42`],
];

async function send([, method, url, body]) {
  const user = pick(users);
  const target = typeof url === 'function' ? url() : url;
  const res = await fetch(target, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${user}`, 'x-user-id': user },
    body: body ? JSON.stringify(body()) : undefined,
  });
  return { status: res.status, url: target };
}

if (seedRounds) {
  // every heavy scenario a few times (one after another, so the apps aren't swamped), plus some normal traffic
  const t0 = Date.now();
  let ok = 0;
  let failed = 0;
  for (let round = 1; round <= seedRounds; round++) {
    for (const s of heavy) {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await send(s);
          if (r.status < 500) ok++;
          else failed++;
          console.log(`${r.status}  ${s[1].padEnd(4)} ${r.url}`);
        } catch (e) {
          failed++;
          console.error(`fail  ${e.message} (is the app running?)`);
        }
      }
    }
    await Promise.allSettled(normal.flatMap((s) => Array.from({ length: s[0] }, () => send(s))));
  }
  console.log(`\nseeded ${ok} heavy requests (${failed} failed) plus normal traffic in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // give the tracers a moment to flush their last batch
  await new Promise((r) => setTimeout(r, 1000));
  process.exit(failed && !ok ? 1 : 0);
}

const scenarios = [...normal, ...heavy];
const total = scenarios.reduce((a, s) => a + s[0], 0);
const next = () => {
  let r = Math.random() * total;
  for (const s of scenarios) if ((r -= s[0]) <= 0) return s;
  return scenarios[0];
};

let sent = 0;
setInterval(() => {
  const s = next();
  send(s)
    .then(() => {
      if (++sent % 50 === 0) console.log(`sent ${sent} requests`);
    })
    .catch((e) => console.error(s[1], typeof s[2] === 'function' ? s[2]() : s[2], e.message));
}, 1000 / rps);
console.log(`sending ~${rps} req/s to the example apps, including heavy loop/recursion scenarios (Ctrl+C to stop)`);
