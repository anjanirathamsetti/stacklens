#!/usr/bin/env node
/**
 * Realistic demo data for exploring StackLens without running any apps.
 *
 *   node scripts/seed-demo.mjs                       # ~6,000 requests over 7 days → http://localhost:4300
 *   node scripts/seed-demo.mjs --requests 20000 --days 14 --endpoint http://localhost:4310/api/ingest
 *   STACKLENS_API_KEY=slk_… node scripts/seed-demo.mjs   # when the server requires an ingest key
 *
 * Builds traces in the wire format (packages/contract) and POSTs them to /api/ingest:
 * 10 applications in 3 projects (storefront, payments, logistics), production + staging, ~2,000 users
 * with a long-tail activity curve, controller → service → repository → SQL call trees, N+1 loops
 * folded into collapsed spans, linked calls between instrumented services (W3C traceparent style),
 * calls to uninstrumented third parties (Stripe, UPS, SendGrid), background jobs, a daily traffic
 * curve, and three incidents: a Stripe outage two days ago, a DB pool exhaustion in orders-api six
 * hours ago and a slow product search since yesterday. Output is deterministic for a given --seed.
 */

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (args.includes('--help')) {
  console.log('options: --requests N (6000) --days N (7) --seed N (42) --endpoint URL (http://localhost:4300/api/ingest)');
  process.exit(0);
}
const REQUESTS = Number(opt('requests', 6000));
const DAYS = Number(opt('days', 7));
const ENDPOINT = opt('endpoint', process.env.STACKLENS_ENDPOINT ?? 'http://localhost:4300/api/ingest');
const API_KEY = process.env.STACKLENS_API_KEY;

/* ------------------------------- randomness ------------------------------- */

let seed = Number(opt('seed', 42)) >>> 0 || 42;
const rand = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];
const chance = (p) => rand() < p;
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
/** log-normal-ish duration around `median` ms */
const ms = (median, spread = 0.5) => {
  const u = Math.max(1e-9, rand()),
    v = rand();
  return Math.max(0.02, median * Math.exp(spread * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
};
const round = (n) => Math.round(n * 1000) / 1000;

/* --------------------------------- people --------------------------------- */

const FIRST = [
  'Ava',
  'Liam',
  'Noah',
  'Mia',
  'Zoe',
  'Ethan',
  'Aria',
  'Leo',
  'Isla',
  'Kai',
  'Nora',
  'Omar',
  'Priya',
  'Ravi',
  'Sofia',
  'Yuki',
  'Lena',
  'Mateo',
  'Chloe',
  'Arjun',
];
const LAST = [
  'Patel',
  'Kim',
  'Garcia',
  'Nguyen',
  'Smith',
  'Rossi',
  'Müller',
  'Silva',
  'Cohen',
  'Tanaka',
  'Okafor',
  'Haddad',
  'Novak',
  'Reyes',
  'Larsen',
];
const USERS = Array.from({ length: 2000 }, (_, i) => {
  const first = pick(FIRST),
    last = pick(LAST);
  return {
    id: `u_${10001 + i}`,
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase().replace('ü', 'u')}${i}@example.com`,
    tier: pick(['free', 'free', 'free', 'plus', 'pro']),
  };
});
/** long tail: user k is picked with weight ~ 1/(k+8) */
const userWeights = USERS.map((_, k) => 1 / (k + 8));
const userTotal = userWeights.reduce((a, b) => a + b, 0);
const pickUser = () => {
  let r = rand() * userTotal;
  for (let k = 0; k < USERS.length; k++) if ((r -= userWeights[k]) <= 0) return USERS[k];
  return USERS[USERS.length - 1];
};

const PRODUCTS = Array.from({ length: 300 }, (_, i) => ({
  sku: `SKU-${(1000 + i).toString(36).toUpperCase()}`,
  name: `${pick(['Trail', 'Urban', 'Classic', 'Aero', 'Nordic', 'Solar', 'Pocket', 'Studio'])} ${pick(['Backpack', 'Sneaker', 'Jacket', 'Bottle', 'Lamp', 'Headphones', 'Watch', 'Mug', 'Desk Mat', 'Keyboard'])}`,
  price: Math.round(ms(45, 0.7) * 100) / 100,
  stock: int(0, 400),
}));

/* ------------------------------- trace build ------------------------------ */

const KIND_BY_PREFIX = [
  [/Controller$/, 'controller'],
  [/Handler$/, 'handler'],
  [/(Service|Client|Engine|Gateway|Cache|Mapper|Validator)$/, 'service'],
  [/Repository$/, 'repository'],
];
const kindOf = (cls) => KIND_BY_PREFIX.find(([re]) => re.test(cls))?.[1] ?? 'function';
const typeOf = (v) =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? v.length
        ? `${typeOf(v[0])}[]`
        : 'unknown[]'
      : typeof v === 'object'
        ? `{ ${Object.keys(v)
            .slice(0, 4)
            .map((k) => `${k}: ${typeOf(v[k])}`)
            .join('; ')}${Object.keys(v).length > 4 ? '; …' : ''} }`
        : typeof v;

class Failure extends Error {
  constructor(name, message, status) {
    super(message);
    this.name = name;
    this.status = status;
  }
}

/**
 * A call node:
 *   { cls, method, params, args, result, self, children, sql, parallel, repeat, out, fail, logs, attributes }
 * `out` = outgoing HTTP call: { app, route, method, path, body, uninstrumented: { host, status, body } }
 */
function build(ctx, node, parentId, start) {
  const id = hex(16);
  const span = {
    id,
    parentId,
    name: node.name ?? `${node.cls}.${node.method}`,
    className: node.cls,
    method: node.method,
    kind: node.kind ?? kindOf(node.cls),
    start: round(start),
    duration: 0,
    status: 'ok',
    async: node.async ?? true,
    params: node.params ?? [],
  };
  if (node.args) {
    span.args = node.args;
    span.argTypes = node.args.map(typeOf);
  }
  if (node.attributes) span.attributes = node.attributes;
  if (node.logs)
    span.logs = node.logs.map((l) => ({
      t: round(start + 0.1),
      level: l.level ?? 'info',
      message: l.message,
      ...(l.data ? { data: l.data } : {}),
    }));
  if (span.className === undefined) delete span.className;
  ctx.spans.push(span);

  let t = start + ms(node.selfBefore ?? 0.08, 0.4);
  let error;
  const kids = node.children ?? [];
  if (node.parallel && kids.length) {
    let end = t;
    for (const k of kids) {
      const r = build(ctx, k, id, t + ms(0.05, 0.3));
      end = Math.max(end, r.end);
      error ??= r.error;
    }
    t = end;
  } else {
    for (const k of kids) {
      const r = build(ctx, k, id, t);
      t = r.end + ms(0.04, 0.3);
      if (r.error) {
        error = r.error;
        break;
      }
    }
  }

  if (node.out && !error) {
    const r = outbound(ctx, node, span, t);
    t = r.end;
    error = r.error;
    if (!error && node.result === undefined && r.body !== undefined && r.body !== '') node.result = r.body;
  }
  if (node.fail && !error) error = node.fail;
  t += ms(node.self ?? 0.15, node.spread ?? 0.6);

  if (node.repeat) {
    span.collapsed = node.repeat;
    t += node.repeat.totalDuration;
  }
  span.duration = round(t - start);
  if (error) {
    span.status = 'error';
    if (!ctx.errorAttached) {
      span.error = {
        name: error.name,
        message: error.message,
        stack: `${error.name}: ${error.message}\n    at ${span.name} (/app/dist/${(node.cls ?? 'index').replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase())}.js:${int(12, 240)}:${int(5, 40)})\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)`,
        ...(error.status ? { status: error.status } : {}),
      };
      ctx.errorAttached = true;
    }
  } else if (node.result !== undefined) {
    span.result = node.result;
    span.resultType = node.resultType ?? (node.async === false ? typeOf(node.result) : `Promise<${typeOf(node.result)}>`);
  }
  return { end: t, error };
}

/**
 * An outgoing HTTP call made by `span`'s method, recorded the way the SDK does it: a child span of
 * kind `http` named `METHOD host/path`, the request as its argument and `{ statusCode, headers, body }`
 * as its result. Instrumented callees get their own trace linked through `parent`. A 5xx fails the
 * HTTP span; a 4xx is a normal response that the calling method turns into an error.
 */
function outbound(ctx, node, caller, t0) {
  const o = node.out;
  const host = o.uninstrumented?.host ?? APPS[o.app].host;
  const url = `https://${host}${o.path}`;
  const name = `${o.method} ${host}${o.path.split('?')[0]}`;
  const start = t0 + ms(0.15, 0.4);
  const span = {
    id: hex(16),
    parentId: caller.id,
    name,
    method: name,
    kind: 'http',
    start: round(start),
    duration: 0,
    status: 'ok',
    async: true,
    params: ['request'],
  };
  ctx.spans.push(span);
  const headers = { 'content-type': 'application/json', authorization: '[redacted]', 'user-agent': 'node' };
  let statusCode,
    resHeaders,
    body,
    dur,
    childId,
    propagated = false;
  if (o.uninstrumented) {
    const u = o.uninstrumented;
    statusCode = u.status;
    resHeaders = { 'content-type': 'application/json' };
    body = u.body;
    dur = ms(u.latency ?? 120, 0.45);
  } else {
    propagated = true;
    headers.traceparent = `00-${ctx.id}-${span.id}-01`;
    headers.tracestate = `stacklens=${ctx.app}`;
    const child = request(o.app, o.route, {
      start: ctx.base + start + ms(0.5, 0.3),
      user: ctx.user,
      env: ctx.env,
      parent: { traceId: ctx.id, spanId: span.id, service: ctx.app },
      body: o.body,
      path: o.path,
      method: o.method,
      fault: ctx.fault,
    });
    statusCode = child.http.statusCode;
    resHeaders = { 'content-type': 'application/json', 'x-stacklens-trace-id': child.id };
    body = child.http.response?.body;
    dur = child.duration + ms(1.2, 0.4);
    childId = child.id;
  }
  const request_ = { method: o.method, url, headers, ...(o.body !== undefined ? { body: o.body } : {}) };
  span.args = [request_];
  span.argTypes = [typeOf(request_)];
  span.outbound = { method: o.method, url, host, statusCode, propagated, ...(childId ? { childTraceId: childId } : {}) };
  span.duration = round(dur);
  const end = start + dur;
  if (statusCode >= 500) {
    const e = new Failure(o.uninstrumented ? 'HttpError' : 'UpstreamError', `${o.method} ${url} responded ${statusCode}`, 502);
    span.status = 'error';
    span.error = { name: 'HttpError', message: `Request failed with status code ${statusCode}`, status: statusCode };
    ctx.errorAttached = true;
    return { end, error: e };
  }
  span.result = { statusCode, headers: resHeaders, ...(body !== undefined && body !== '' ? { body } : {}) };
  span.resultType = typeOf(span.result);
  if (statusCode >= 400) {
    const u = o.uninstrumented?.error;
    return { end, error: new Failure(u?.name ?? 'HttpError', u?.message ?? `${o.app ?? host} responded ${statusCode}`, statusCode), body };
  }
  return { end, error: undefined, body };
}

const sql = (query, parameters, rows, median = 0.9) => ({
  name: 'SQL.query',
  cls: 'SQL',
  method: 'query',
  kind: 'db',
  params: ['query', 'parameters'],
  args: [query, parameters],
  result: rows,
  self: median,
  spread: 0.7,
});
const repo = (cls, method, params, args, result, query, qparams, median) => ({
  cls,
  method,
  params,
  args,
  result,
  children: [sql(query, qparams, Array.isArray(result) ? result : result ? [result] : [], median)],
});
const loop = (count, median) => {
  const durations = Array.from({ length: Math.min(count, 200) }, () => ms(median, 0.5));
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  return {
    count,
    totalDuration: round(avg * count),
    minDuration: round(Math.min(...durations)),
    maxDuration: round(Math.max(...durations)),
    errors: 0,
  };
};

/* --------------------------------- the apps -------------------------------- */

/** Faults active at a given time: incidents baked into the timeline. */
function faultsAt(ts, now) {
  const h = (now - ts) / 3600e3;
  return {
    stripeDown: h > 46 && h < 47.2, // card payments failing, two days ago
    dbPool: h > 5.6 && h < 6.3, // orders-api connection pool exhausted, six hours ago
    slowSearch: h < 26, // product search regression since yesterday
  };
}

const order = (user, items) => ({
  id: `ord_${hex(10)}`,
  userId: user.id,
  items,
  total: Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100,
  currency: 'USD',
  status: 'placed',
});

const APPS = {
  /* storefront */
  'web-gateway': {
    project: 'storefront',
    host: 'gateway.shop.internal',
    routes: {
      'GET /api/home': (c) => ({
        cls: 'HomeController',
        method: 'home',
        params: ['req'],
        args: [{ userId: c.user.id }],
        result: { sections: 3 },
        children: [
          {
            cls: 'HomeService',
            method: 'compose',
            params: ['userId'],
            args: [c.user.id],
            parallel: true,
            result: { featured: 12, cartItems: 2 },
            children: [
              {
                cls: 'CatalogClient',
                method: 'featured',
                params: [],
                args: [],
                out: { app: 'catalog-api', route: 'GET /products/featured', method: 'GET', path: '/products/featured' },
              },
              {
                cls: 'CartClient',
                method: 'get',
                params: ['userId'],
                args: [c.user.id],
                out: { app: 'cart-api', route: 'GET /cart/:userId', method: 'GET', path: `/cart/${c.user.id}` },
              },
            ],
          },
        ],
      }),
      'GET /api/search': (c) => {
        const q = pick(['backpack', 'trail shoes', 'lamp', 'mug', 'keyboard', 'jacket']);
        return {
          cls: 'SearchController',
          method: 'search',
          params: ['q', 'page'],
          args: [q, 1],
          result: { total: int(0, 80) },
          children: [
            {
              cls: 'CatalogClient',
              method: 'search',
              params: ['q'],
              args: [q],
              out: {
                app: 'catalog-api',
                route: 'GET /products/search',
                method: 'GET',
                path: `/products/search?q=${encodeURIComponent(q)}`,
              },
            },
          ],
        };
      },
      'POST /api/checkout': (c) => {
        const items = Array.from({ length: int(1, 4) }, () => {
          const p = pick(PRODUCTS);
          return { sku: p.sku, qty: int(1, 3), price: p.price };
        });
        return {
          cls: 'CheckoutController',
          method: 'checkout',
          params: ['req', 'res'],
          args: [{ userId: c.user.id, items: items.length }],
          children: [
            {
              cls: 'CheckoutService',
              method: 'checkout',
              params: ['userId', 'items', 'zip'],
              args: [c.user.id, items, String(int(10001, 99950))],
              result: { status: 'confirmed' },
              children: [
                {
                  cls: 'CartClient',
                  method: 'get',
                  params: ['userId'],
                  args: [c.user.id],
                  out: { app: 'cart-api', route: 'GET /cart/:userId', method: 'GET', path: `/cart/${c.user.id}` },
                },
                {
                  cls: 'ShippingClient',
                  method: 'quote',
                  params: ['zip', 'items'],
                  args: ['94107', items.length],
                  out: {
                    app: 'shipping-api',
                    route: 'POST /quotes',
                    method: 'POST',
                    path: '/quotes',
                    body: { zip: '94107', items: items.length },
                  },
                },
                {
                  cls: 'OrdersClient',
                  method: 'create',
                  params: ['order'],
                  args: [{ userId: c.user.id, items }],
                  out: { app: 'orders-api', route: 'POST /orders', method: 'POST', path: '/orders', body: { userId: c.user.id, items } },
                },
              ],
            },
          ],
        };
      },
      'GET /api/account': (c) => ({
        cls: 'AccountController',
        method: 'me',
        params: ['req'],
        args: [{ userId: c.user.id }],
        result: { id: c.user.id, name: c.user.name, tier: c.user.tier },
        children: [
          {
            cls: 'SessionService',
            method: 'verify',
            params: ['token'],
            args: ['[redacted]'],
            result: { userId: c.user.id, valid: true },
            self: 0.3,
          },
          {
            cls: 'OrdersClient',
            method: 'recent',
            params: ['userId'],
            args: [c.user.id],
            out: { app: 'orders-api', route: 'GET /orders', method: 'GET', path: `/orders?userId=${c.user.id}` },
          },
        ],
      }),
    },
  },
  'catalog-api': {
    project: 'storefront',
    host: 'catalog.shop.internal',
    routes: {
      'GET /products/featured': () => {
        const items = Array.from({ length: 12 }, () => pick(PRODUCTS));
        const hit = chance(0.7);
        return {
          cls: 'ProductsController',
          method: 'featured',
          params: [],
          args: [],
          result: items.slice(0, 3),
          children: [
            {
              cls: 'ProductCache',
              method: 'get',
              params: ['key'],
              args: ['featured:v3'],
              result: hit ? items.slice(0, 3) : null,
              self: 0.4,
            },
            ...(hit
              ? []
              : [
                  repo(
                    'ProductRepository',
                    'findFeatured',
                    ['limit'],
                    [12],
                    items.slice(0, 2),
                    'SELECT "p"."sku", "p"."name", "p"."price" FROM "products" "p" WHERE "p"."featured" = true ORDER BY "p"."rank" ASC LIMIT $1',
                    [12],
                    3.2,
                  ),
                  {
                    cls: 'ProductCache',
                    method: 'set',
                    params: ['key', 'value', 'ttl'],
                    args: ['featured:v3', '[12 items]', 300],
                    result: true,
                    self: 0.3,
                  },
                ]),
          ],
        };
      },
      'GET /products/:sku': () => {
        const p = pick(PRODUCTS);
        const missing = chance(0.04);
        return {
          cls: 'ProductsController',
          method: 'findOne',
          params: ['sku'],
          args: [p.sku],
          result: p,
          children: [
            {
              cls: 'ProductService',
              method: 'findBySku',
              params: ['sku'],
              args: [p.sku],
              result: missing ? undefined : p,
              fail: missing ? new Failure('NotFoundException', `Product ${p.sku} not found`, 404) : undefined,
              children: [
                repo(
                  'ProductRepository',
                  'findOne',
                  ['options'],
                  [{ where: { sku: p.sku } }],
                  missing ? null : p,
                  'SELECT * FROM "products" "p" WHERE "p"."sku" = $1 LIMIT 1',
                  [p.sku],
                  0.8,
                ),
              ],
            },
          ],
        };
      },
      'GET /products/search': (c) => {
        const q = pick(['backpack', 'trail', 'lamp', 'mug', 'keyboard', 'jacket']);
        const rows = PRODUCTS.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
        const slow = c.fault.slowSearch;
        return {
          cls: 'SearchController',
          method: 'search',
          params: ['q'],
          args: [q],
          result: rows.slice(0, 3),
          children: [
            {
              cls: 'SearchService',
              method: 'query',
              params: ['q', 'filters'],
              args: [q, { inStock: true }],
              result: { total: rows.length },
              children: [
                repo(
                  'ProductRepository',
                  'search',
                  ['term', 'limit'],
                  [q, 20],
                  rows.slice(0, 3),
                  `SELECT "p".* FROM "products" "p" WHERE "p"."name" ILIKE $1${slow ? '' : ' AND "p"."search_vector" @@ plainto_tsquery($2)'} ORDER BY "p"."rank" LIMIT 20`,
                  slow ? [`%${q}%`] : [`%${q}%`, q],
                  slow ? 420 : 6,
                ),
                {
                  cls: 'PriceMapper',
                  method: 'toDto',
                  params: ['product'],
                  args: [rows[0] ?? null],
                  async: false,
                  repeat: rows.length > 1 ? loop(rows.length - 1, 0.03) : undefined,
                  result: rows[0] ? { sku: rows[0].sku, price: `$${rows[0].price}` } : null,
                  self: 0.02,
                },
              ],
            },
          ],
        };
      },
    },
  },
  'cart-api': {
    project: 'storefront',
    host: 'cart.shop.internal',
    routes: {
      'GET /cart/:userId': (c) => {
        const items = Array.from({ length: int(0, 5) }, () => {
          const p = pick(PRODUCTS);
          return { sku: p.sku, qty: int(1, 2), price: p.price };
        });
        return {
          cls: 'CartController',
          method: 'get',
          params: ['userId'],
          args: [c.user.id],
          result: { items, count: items.length },
          children: [
            {
              cls: 'CartService',
              method: 'load',
              params: ['userId'],
              args: [c.user.id],
              result: { items },
              children: [
                {
                  cls: 'RedisCache',
                  method: 'get',
                  params: ['key'],
                  args: [`cart:${c.user.id}`],
                  result: items.length ? JSON.stringify(items).slice(0, 80) + '…' : null,
                  self: 0.5,
                },
              ],
            },
          ],
        };
      },
      'POST /cart/:userId/items': (c) => {
        const p = pick(PRODUCTS);
        const oos = p.stock === 0;
        return {
          cls: 'CartController',
          method: 'addItem',
          params: ['userId', 'body'],
          args: [c.user.id, { sku: p.sku, qty: 1 }],
          result: { ok: true },
          children: [
            {
              cls: 'CartService',
              method: 'add',
              params: ['userId', 'sku', 'qty'],
              args: [c.user.id, p.sku, 1],
              fail: oos ? new Failure('ConflictException', `${p.sku} is out of stock`, 409) : undefined,
              result: { count: int(1, 6) },
              children: [
                {
                  cls: 'InventoryClient',
                  method: 'check',
                  params: ['sku'],
                  args: [p.sku],
                  out: { app: 'inventory-api', route: 'GET /stock/:sku', method: 'GET', path: `/stock/${p.sku}` },
                },
                ...(oos
                  ? []
                  : [
                      {
                        cls: 'RedisCache',
                        method: 'set',
                        params: ['key', 'value'],
                        args: [`cart:${c.user.id}`, '[cart]'],
                        result: 'OK',
                        self: 0.4,
                      },
                    ]),
              ],
            },
          ],
        };
      },
    },
  },
  'orders-api': {
    project: 'storefront',
    host: 'orders.shop.internal',
    routes: {
      'POST /orders': (c) => {
        const items = c.body?.items ?? [{ sku: pick(PRODUCTS).sku, qty: 1, price: 19.99 }];
        const o = order(c.user, items);
        const pool = c.fault.dbPool && chance(0.7);
        return {
          cls: 'OrdersController',
          method: 'create',
          params: ['dto'],
          args: [{ userId: c.user.id, items }],
          result: o,
          children: [
            {
              cls: 'OrdersService',
              method: 'place',
              params: ['userId', 'items'],
              args: [c.user.id, items],
              result: o,
              children: [
                { cls: 'OrderValidator', method: 'validate', params: ['items'], args: [items], async: false, result: true, self: 0.05 },
                {
                  cls: 'InventoryClient',
                  method: 'reserve',
                  params: ['items'],
                  args: [items],
                  out: {
                    app: 'inventory-api',
                    route: 'POST /reservations',
                    method: 'POST',
                    path: '/reservations',
                    body: { orderId: o.id, items },
                  },
                },
                {
                  cls: 'PaymentsClient',
                  method: 'charge',
                  params: ['userId', 'amount'],
                  args: [c.user.id, o.total],
                  out: {
                    app: 'payments-api',
                    route: 'POST /charges',
                    method: 'POST',
                    path: '/charges',
                    body: { userId: c.user.id, amount: o.total, currency: 'USD' },
                  },
                },
                {
                  cls: 'OrderRepository',
                  method: 'save',
                  params: ['order'],
                  args: [o],
                  result: { ...o, createdAt: new Date(c.start).toISOString() },
                  fail: pool
                    ? new Failure(
                        'QueryFailedError',
                        'remaining connection slots are reserved for non-replication superuser connections',
                        500,
                      )
                    : undefined,
                  children: pool
                    ? []
                    : [
                        sql(
                          'INSERT INTO "orders"("id", "user_id", "total", "currency", "status") VALUES ($1, $2, $3, $4, $5) RETURNING "created_at"',
                          [o.id, c.user.id, o.total, 'USD', 'placed'],
                          [{ created_at: new Date(c.start).toISOString() }],
                          1.6,
                        ),
                        {
                          ...sql(
                            'INSERT INTO "order_items"("order_id", "sku", "qty", "price") VALUES ($1, $2, $3, $4)',
                            [o.id, items[0].sku, items[0].qty, items[0].price],
                            [],
                            0.7,
                          ),
                          repeat: items.length > 1 ? loop(items.length - 1, 0.7) : undefined,
                        },
                      ],
                },
                {
                  cls: 'EventsClient',
                  method: 'publish',
                  params: ['topic', 'event'],
                  args: ['order.placed', { orderId: o.id }],
                  out: {
                    app: 'notifications-worker',
                    route: 'POST /events',
                    method: 'POST',
                    path: '/events',
                    body: { type: 'order.placed', orderId: o.id },
                  },
                },
              ],
            },
          ],
        };
      },
      'GET /orders': (c) => {
        const n = int(3, 60);
        const orders = Array.from({ length: Math.min(n, 3) }, () => order(c.user, [{ sku: pick(PRODUCTS).sku, qty: 1, price: 24.5 }]));
        return {
          cls: 'OrdersController',
          method: 'list',
          params: ['userId'],
          args: [c.user.id],
          result: orders,
          children: [
            {
              cls: 'OrdersService',
              method: 'listForUser',
              params: ['userId'],
              args: [c.user.id],
              result: orders,
              logs: n > 40 ? [{ level: 'warn', message: `loading items one order at a time (${n} orders)` }] : undefined,
              children: [
                repo(
                  'OrderRepository',
                  'find',
                  ['options'],
                  [{ where: { userId: c.user.id }, order: { createdAt: 'DESC' } }],
                  orders,
                  'SELECT * FROM "orders" WHERE "user_id" = $1 ORDER BY "created_at" DESC',
                  [c.user.id],
                  2.1,
                ),
                {
                  cls: 'OrderItemRepository',
                  method: 'findByOrder',
                  params: ['orderId'],
                  args: [orders[0].id],
                  result: orders[0].items,
                  repeat: loop(n - 1, 0.9),
                  children: [sql('SELECT * FROM "order_items" WHERE "order_id" = $1', [orders[0].id], orders[0].items, 0.8)],
                },
              ],
            },
          ],
        };
      },
      'GET /orders/:id': (c) => {
        const o = order(c.user, [{ sku: pick(PRODUCTS).sku, qty: 2, price: 12 }]);
        const forbidden = chance(0.03);
        return {
          cls: 'OrdersController',
          method: 'findOne',
          params: ['id', 'user'],
          args: [o.id, { id: c.user.id }],
          result: o,
          children: [
            {
              cls: 'OrdersService',
              method: 'getForUser',
              params: ['id', 'userId'],
              args: [o.id, c.user.id],
              fail: forbidden ? new Failure('ForbiddenException', 'Order belongs to another customer', 403) : undefined,
              result: o,
              children: [
                repo(
                  'OrderRepository',
                  'findOne',
                  ['options'],
                  [{ where: { id: o.id }, relations: ['items'] }],
                  o,
                  'SELECT "o".*, "i".* FROM "orders" "o" LEFT JOIN "order_items" "i" ON "i"."order_id" = "o"."id" WHERE "o"."id" = $1',
                  [o.id],
                  1.4,
                ),
              ],
            },
          ],
        };
      },
    },
  },
  /* payments */
  'payments-api': {
    project: 'payments',
    host: 'payments.pay.internal',
    routes: {
      'POST /charges': (c) => {
        const amount = c.body?.amount ?? 49.9;
        const declined = chance(0.05);
        const down = c.fault.stripeDown && chance(0.85);
        return {
          cls: 'ChargesController',
          method: 'create',
          params: ['dto'],
          args: [{ userId: c.user.id, amount, currency: 'USD' }],
          result: { id: `ch_${hex(12)}`, status: 'succeeded' },
          children: [
            {
              cls: 'ChargeService',
              method: 'charge',
              params: ['userId', 'amount', 'currency'],
              args: [c.user.id, amount, 'USD'],
              result: { id: `ch_${hex(12)}`, status: 'succeeded', last4: '4242' },
              children: [
                {
                  cls: 'FraudClient',
                  method: 'score',
                  params: ['payload'],
                  args: [{ userId: c.user.id, amount }],
                  out: { app: 'fraud-service', route: 'POST /score', method: 'POST', path: '/score', body: { userId: c.user.id, amount } },
                },
                {
                  cls: 'StripeGateway',
                  method: 'createCharge',
                  params: ['amount', 'source'],
                  args: [Math.round(amount * 100), 'card_[redacted]'],
                  out: {
                    method: 'POST',
                    path: '/v1/charges',
                    body: { amount: Math.round(amount * 100), currency: 'usd', source: '[redacted]' },
                    uninstrumented: down
                      ? {
                          host: 'api.stripe.com',
                          status: 503,
                          latency: 2900,
                          body: { error: { type: 'api_error', message: 'Service unavailable' } },
                        }
                      : declined
                        ? {
                            host: 'api.stripe.com',
                            status: 402,
                            latency: 380,
                            body: { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } },
                            error: { name: 'CardDeclinedError', message: 'Your card was declined.' },
                          }
                        : {
                            host: 'api.stripe.com',
                            status: 200,
                            latency: 340,
                            body: { id: `ch_${hex(12)}`, status: 'succeeded', outcome: { risk_level: 'normal' } },
                          },
                  },
                },
                {
                  cls: 'LedgerRepository',
                  method: 'insert',
                  params: ['entry'],
                  args: [{ userId: c.user.id, amount, type: 'charge' }],
                  result: { id: int(100000, 999999) },
                  children: [
                    sql(
                      'INSERT INTO "ledger"("user_id", "amount", "type") VALUES ($1, $2, $3) RETURNING "id"',
                      [c.user.id, amount, 'charge'],
                      [{ id: int(100000, 999999) }],
                      1.1,
                    ),
                  ],
                },
              ],
            },
          ],
        };
      },
      'POST /refunds': (c) => ({
        cls: 'RefundsController',
        method: 'create',
        params: ['dto'],
        args: [{ chargeId: `ch_${hex(12)}`, reason: pick(['requested_by_customer', 'duplicate', 'damaged']) }],
        result: { status: 'pending' },
        children: [
          {
            cls: 'RefundService',
            method: 'refund',
            params: ['chargeId'],
            args: [`ch_${hex(12)}`],
            result: { id: `re_${hex(10)}` },
            children: [
              {
                cls: 'StripeGateway',
                method: 'createRefund',
                params: ['charge'],
                args: ['ch_[redacted]'],
                out: {
                  method: 'POST',
                  path: '/v1/refunds',
                  body: { charge: '[redacted]' },
                  uninstrumented: { host: 'api.stripe.com', status: 200, latency: 420, body: { id: `re_${hex(10)}`, status: 'pending' } },
                },
              },
            ],
          },
        ],
      }),
    },
  },
  'fraud-service': {
    project: 'payments',
    host: 'fraud.pay.internal',
    routes: {
      'POST /score': (c) => {
        const score = Math.round(rand() * 100) / 100;
        return {
          cls: 'ScoreController',
          method: 'score',
          params: ['payload'],
          args: [{ userId: c.user.id, amount: c.body?.amount }],
          result: { score, decision: score > 0.92 ? 'review' : 'approve' },
          children: [
            {
              cls: 'FeatureService',
              method: 'load',
              params: ['userId'],
              args: [c.user.id],
              result: { orders30d: int(0, 12), chargebacks: 0, accountAgeDays: int(1, 900) },
              children: [
                repo(
                  'FeatureRepository',
                  'findByUser',
                  ['userId'],
                  [c.user.id],
                  { orders30d: int(0, 12) },
                  'SELECT * FROM "risk_features" WHERE "user_id" = $1',
                  [c.user.id],
                  0.9,
                ),
              ],
            },
            {
              cls: 'RulesEngine',
              method: 'evaluate',
              params: ['rule', 'features'],
              args: ['velocity_24h', { orders30d: 3 }],
              async: false,
              result: { hit: false },
              repeat: loop(31, 0.05),
              self: 0.04,
            },
            { cls: 'ModelService', method: 'predict', params: ['vector'], args: ['[48 features]'], result: score, self: 4.5, spread: 0.3 },
          ],
        };
      },
    },
  },
  'billing-api': {
    project: 'payments',
    host: 'billing.pay.internal',
    routes: {
      'GET /invoices/:userId': (c) => {
        const inv = {
          id: `inv_${hex(8)}`,
          userId: c.user.id,
          amount: Math.round(ms(60, 0.6) * 100) / 100,
          status: pick(['paid', 'paid', 'open']),
        };
        return {
          cls: 'InvoicesController',
          method: 'list',
          params: ['userId'],
          args: [c.user.id],
          result: [inv],
          children: [
            {
              cls: 'InvoiceService',
              method: 'forUser',
              params: ['userId'],
              args: [c.user.id],
              result: [inv],
              children: [
                repo(
                  'InvoiceRepository',
                  'find',
                  ['options'],
                  [{ where: { userId: c.user.id } }],
                  [inv],
                  'SELECT * FROM "invoices" WHERE "user_id" = $1 ORDER BY "issued_at" DESC LIMIT 24',
                  [c.user.id],
                  1.8,
                ),
              ],
            },
          ],
        };
      },
      'job nightly-invoice-run': () => {
        const n = int(800, 1400);
        return {
          cls: 'InvoiceRunHandler',
          method: 'run',
          params: ['date'],
          args: [new Date().toISOString().slice(0, 10)],
          result: { invoiced: n, failed: int(0, 4) },
          logs: [{ message: `invoicing ${n} accounts` }],
          children: [
            repo(
              'AccountRepository',
              'findBillable',
              ['date'],
              ['today'],
              [{ id: 'acct_1' }],
              'SELECT "id" FROM "accounts" WHERE "next_invoice_at" <= now()',
              [],
              40,
            ),
            {
              cls: 'InvoiceService',
              method: 'issue',
              params: ['accountId'],
              args: ['acct_1'],
              result: { id: `inv_${hex(8)}` },
              repeat: loop(n - 1, 2.4),
              children: [sql('INSERT INTO "invoices"("account_id", "amount") VALUES ($1, $2)', ['acct_1', 19], [], 1.2)],
            },
          ],
        };
      },
    },
  },
  /* logistics */
  'inventory-api': {
    project: 'logistics',
    host: 'inventory.ops.internal',
    routes: {
      'GET /stock/:sku': () => {
        const p = pick(PRODUCTS);
        return {
          cls: 'StockController',
          method: 'get',
          params: ['sku'],
          args: [p.sku],
          result: { sku: p.sku, available: p.stock },
          children: [
            repo(
              'StockRepository',
              'findOne',
              ['sku'],
              [p.sku],
              { sku: p.sku, available: p.stock },
              'SELECT "sku", "available" FROM "stock" WHERE "sku" = $1',
              [p.sku],
              0.6,
            ),
          ],
        };
      },
      'POST /reservations': (c) => {
        const items = c.body?.items ?? [{ sku: pick(PRODUCTS).sku, qty: 1 }];
        const short = chance(0.03);
        return {
          cls: 'ReservationsController',
          method: 'create',
          params: ['dto'],
          args: [{ orderId: c.body?.orderId, items }],
          result: { reservationId: `res_${hex(8)}` },
          children: [
            {
              cls: 'ReservationService',
              method: 'reserve',
              params: ['items'],
              args: [items],
              fail: short ? new Failure('InsufficientStockError', `Only ${int(0, 1)} left of ${items[0].sku}`, 409) : undefined,
              result: { reserved: items.length },
              children: [
                {
                  ...repo(
                    'StockRepository',
                    'decrement',
                    ['sku', 'qty'],
                    [items[0].sku, items[0].qty],
                    { affected: 1 },
                    'UPDATE "stock" SET "available" = "available" - $2 WHERE "sku" = $1 AND "available" >= $2',
                    [items[0].sku, items[0].qty],
                    1.3,
                  ),
                  repeat: items.length > 1 ? loop(items.length - 1, 1.4) : undefined,
                },
              ],
            },
          ],
        };
      },
      'job stock-sync': () => ({
        cls: 'StockSyncHandler',
        method: 'run',
        params: [],
        args: [],
        result: { updated: int(200, 300) },
        children: [
          {
            cls: 'WarehouseClient',
            method: 'export',
            params: [],
            args: [],
            out: {
              method: 'GET',
              path: '/v2/inventory/export',
              uninstrumented: { host: 'wms.partner-logistics.com', status: 200, latency: 900, body: { items: '[284 rows]' } },
            },
          },
          {
            cls: 'StockRepository',
            method: 'upsert',
            params: ['row'],
            args: [{ sku: pick(PRODUCTS).sku, available: 12 }],
            result: { affected: 1 },
            repeat: loop(283, 0.9),
            children: [
              sql(
                'INSERT INTO "stock"("sku", "available") VALUES ($1, $2) ON CONFLICT ("sku") DO UPDATE SET "available" = EXCLUDED."available"',
                ['SKU-RS', 12],
                [],
                0.8,
              ),
            ],
          },
        ],
      }),
    },
  },
  'shipping-api': {
    project: 'logistics',
    host: 'shipping.ops.internal',
    routes: {
      'POST /quotes': (c) => ({
        cls: 'QuotesController',
        method: 'create',
        params: ['dto'],
        args: [c.body ?? { zip: '94107', items: 1 }],
        result: { carrier: 'UPS', service: 'Ground', amount: 7.99, days: 3 },
        children: [
          {
            cls: 'RateService',
            method: 'quote',
            params: ['zip', 'weightKg'],
            args: [c.body?.zip ?? '94107', 1.2],
            result: { amount: 7.99 },
            children: [
              {
                cls: 'UpsClient',
                method: 'rates',
                params: ['shipment'],
                args: [{ to: c.body?.zip ?? '94107', weightKg: 1.2 }],
                out: {
                  method: 'POST',
                  path: '/api/rating/v1/Shop',
                  body: { shipTo: { postalCode: c.body?.zip ?? '94107' }, weight: 1.2 },
                  uninstrumented: {
                    host: 'onlinetools.ups.com',
                    status: chance(0.02) ? 504 : 200,
                    latency: 210,
                    body: { RateResponse: { RatedShipment: [{ Service: 'Ground', TotalCharges: '7.99' }] } },
                  },
                },
              },
            ],
          },
        ],
      }),
      'GET /tracking/:id': () => {
        const id = `1Z${hex(8).toUpperCase()}`;
        return {
          cls: 'TrackingController',
          method: 'get',
          params: ['id'],
          args: [id],
          result: { status: pick(['in_transit', 'delivered', 'label_created']) },
          children: [
            repo(
              'ShipmentRepository',
              'findByTracking',
              ['trackingId'],
              [id],
              { id, carrier: 'UPS' },
              'SELECT * FROM "shipments" WHERE "tracking_id" = $1',
              [id],
              0.9,
            ),
          ],
        };
      },
    },
  },
  'notifications-worker': {
    project: 'logistics',
    host: 'notify.ops.internal',
    routes: {
      'POST /events': (c) => ({
        cls: 'EventsController',
        method: 'receive',
        params: ['event'],
        args: [c.body ?? { type: 'order.placed' }],
        result: { queued: true },
        children: [
          {
            cls: 'EmailService',
            method: 'sendOrderConfirmation',
            params: ['to', 'orderId'],
            args: [c.user.email, c.body?.orderId],
            result: { messageId: `<${hex(12)}@mail>` },
            children: [
              {
                cls: 'TemplateService',
                method: 'render',
                params: ['template', 'vars'],
                args: ['order-confirmation', { name: c.user.name }],
                async: false,
                result: '<html>… 14 KB',
                self: 1.8,
              },
              {
                cls: 'SendgridClient',
                method: 'send',
                params: ['message'],
                args: [{ to: c.user.email, template: 'order-confirmation' }],
                out: {
                  method: 'POST',
                  path: '/v3/mail/send',
                  body: { personalizations: [{ to: [{ email: c.user.email }] }] },
                  uninstrumented: { host: 'api.sendgrid.com', status: 202, latency: 160, body: '' },
                },
              },
            ],
          },
        ],
      }),
      'job send-digest-emails': () => {
        const n = int(150, 420);
        return {
          cls: 'DigestHandler',
          method: 'run',
          params: [],
          args: [],
          result: { sent: n },
          children: [
            {
              cls: 'SendgridClient',
              method: 'send',
              params: ['message'],
              args: [{ to: '[recipient]', template: 'weekly-digest' }],
              repeat: loop(n - 1, 140),
              out: {
                method: 'POST',
                path: '/v3/mail/send',
                body: { template_id: 'd-weekly' },
                uninstrumented: { host: 'api.sendgrid.com', status: 202, latency: 140, body: '' },
              },
            },
          ],
        };
      },
    },
  },
};

/* --------------------------------- requests -------------------------------- */

function request(app, route, o) {
  const def = APPS[app];
  const [verb, ...rest] = route.split(' ');
  const isJob = verb === 'job';
  const path =
    o.path ?? rest.join(' ').replace(/:(\w+)/g, (_, k) => (k === 'userId' ? o.user.id : k === 'sku' ? pick(PRODUCTS).sku : hex(6)));
  const ctx = { id: hex(32), app, spans: [], base: o.start, user: o.user, env: o.env, fault: o.fault, errorAttached: false };
  const tree = def.routes[route]({ user: o.user, body: o.body, fault: o.fault, start: o.start });
  const rootKind = isJob ? 'job' : 'http';
  const root = {
    name: isJob ? rest.join(' ') : `${verb} ${rest.join(' ')}`,
    cls: undefined,
    method: isJob ? rest.join(' ') : verb,
    kind: rootKind,
    params: [],
    children: [tree],
    self: 0.6,
  };
  const { end, error } = build(ctx, root, null, 0);
  const statusCode = isJob ? undefined : error ? (error.status ?? 500) : verb === 'POST' ? 201 : 200;
  const trace = {
    id: ctx.id,
    service: app,
    application: app,
    project: def.project,
    environment: o.env,
    ...(isJob ? {} : { userId: o.user.id }),
    name: root.name,
    kind: rootKind,
    startTime: Math.round(o.start),
    duration: round(end),
    status: error ? 'error' : 'ok',
    spans: ctx.spans,
    ...(o.parent ? { parent: o.parent } : {}),
  };
  if (!isJob) {
    trace.http = {
      method: verb,
      url: path,
      route: rest.join(' '),
      statusCode,
      ip: `10.${int(0, 20)}.${int(0, 255)}.${int(1, 254)}`,
      request: {
        headers: {
          'user-agent': pick(['Mozilla/5.0 (Macintosh)', 'Mozilla/5.0 (iPhone)', 'node', 'okhttp/4.12']),
          authorization: '[redacted]',
        },
        query: {},
        params: {},
        body: o.body,
      },
      response: { headers: { 'content-type': 'application/json' }, body: error ? { statusCode, message: error.message } : { ok: true } },
    };
  }
  if (error && !isJob && statusCode < 500) {
    // 4xx: the request is answered, not a server failure
    trace.status = 'error';
  }
  out.push(trace);
  return trace;
}

/* -------------------------------- timeline -------------------------------- */

/** entry points users hit (callers fan out to the other services from here) */
const ENTRY = [
  ['web-gateway', 'GET /api/home', 22],
  ['web-gateway', 'GET /api/search', 14],
  ['web-gateway', 'POST /api/checkout', 7],
  ['web-gateway', 'GET /api/account', 6],
  ['catalog-api', 'GET /products/:sku', 16],
  ['cart-api', 'POST /cart/:userId/items', 8],
  ['orders-api', 'GET /orders/:id', 5],
  ['billing-api', 'GET /invoices/:userId', 4],
  ['payments-api', 'POST /refunds', 1],
  ['shipping-api', 'GET /tracking/:id', 5],
];
const entryTotal = ENTRY.reduce((s, e) => s + e[2], 0);
const pickEntry = () => {
  let r = rand() * entryTotal;
  for (const e of ENTRY) if ((r -= e[2]) <= 0) return e;
  return ENTRY[0];
};
/** relative traffic at a point in time: daytime peak, quieter nights and weekends */
const traffic = (ts) => {
  const d = new Date(ts);
  const h = d.getHours() + d.getMinutes() / 60;
  const day = 0.25 + Math.exp(-((h - 14.5) ** 2) / 18) + 0.35 * Math.exp(-((h - 20.5) ** 2) / 4);
  return day * (d.getDay() === 0 || d.getDay() === 6 ? 0.65 : 1);
};

const out = [];
const now = Date.now();
const from = now - DAYS * 86400e3;
let made = 0;
while (made < REQUESTS) {
  const ts = from + rand() * (now - from - 60e3);
  if (rand() > traffic(ts) / 1.4) continue;
  const [app, route] = pickEntry();
  request(app, route, { start: ts, user: pickUser(), env: chance(0.12) ? 'staging' : 'production', fault: faultsAt(ts, now) });
  made++;
}
// scheduled jobs
for (let d = 0; d < DAYS; d++) {
  const day = new Date(now - d * 86400e3);
  day.setHours(2, int(0, 10), 0, 0);
  if (day.getTime() < now)
    request('billing-api', 'job nightly-invoice-run', {
      start: day.getTime(),
      user: USERS[0],
      env: 'production',
      fault: faultsAt(day.getTime(), now),
    });
  for (let h = 0; h < 24; h += 4) {
    const t = new Date(day);
    t.setHours(h, 15, 0, 0);
    if (t.getTime() < now && t.getTime() > from)
      request('inventory-api', 'job stock-sync', {
        start: t.getTime(),
        user: USERS[0],
        env: 'production',
        fault: faultsAt(t.getTime(), now),
      });
  }
  const mon = new Date(day);
  mon.setHours(9, 0, 0, 0);
  if (mon.getDay() === 1 && mon.getTime() < now)
    request('notifications-worker', 'job send-digest-emails', {
      start: mon.getTime(),
      user: USERS[0],
      env: 'production',
      fault: faultsAt(mon.getTime(), now),
    });
}

/* ---------------------------------- send ---------------------------------- */

out.sort((a, b) => a.startTime - b.startTime);
if (args.includes('--dry-run')) {
  // check every trace against the wire contract instead of sending
  const { validate } = await import('../packages/contract/schema/validate.mjs');
  const bad = out.map((t) => [t.id, validate(t, 'TraceRecord')]).filter(([, e]) => e.length);
  console.log(`${out.length} traces, ${bad.length} invalid`);
  for (const [id, e] of bad.slice(0, 5)) console.log(id, e.slice(0, 5));
  process.exit(bad.length ? 1 : 0);
}
const headers = { 'content-type': 'application/json', ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}) };
const apps = new Set(out.map((t) => t.application));
console.log(
  `sending ${out.length} traces (${made} requests + linked calls and jobs) from ${apps.size} applications over ${DAYS} days to ${ENDPOINT}`,
);
let sent = 0;
for (let i = 0; i < out.length; i += 100) {
  const batch = out.slice(i, i + 100);
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ traces: batch }) });
  if (!res.ok) {
    console.error(`ingest failed: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  sent += batch.length;
  if (sent % 2000 < 100) process.stdout.write(`  ${sent}/${out.length}\n`);
}
console.log(`done: ${sent} traces, ${new Set(out.filter((t) => t.userId).map((t) => t.userId)).size} users`);
