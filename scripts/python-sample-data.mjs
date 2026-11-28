#!/usr/bin/env node
/**
 * Sample data from the Python examples: starts catalog-api (FastAPI), inventory-api (Flask), the Celery
 * worker and the fake providers, plus the Node examples they call and that call them (orders-api,
 * billing-api, shipping-service), sends realistic traffic, waits for the traces to be exported, and stops
 * everything again.
 *
 *   npm run sample:python                                   # → http://localhost:4310/api/ingest
 *   npm run sample:python -- --requests 1500
 *   npm run sample:python -- --endpoint http://localhost:4200/api/ingest   # the demo server
 *
 * The StackLens server itself is not started: run a throwaway one first (see examples/python/README.md).
 * Ports: Python 3011–3013, Node examples 3031–3033 (so the usual 3001–3003 can keep running).
 * Sending to the main server on :4300 needs --main (it usually holds real data).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const endpoint = opt('endpoint', process.env.STACKLENS_ENDPOINT ?? 'http://localhost:4310/api/ingest');
const requests = Number(opt('requests', 600));
const rps = Number(opt('rps', 20));
const python =
  opt('python') ??
  [join(root, 'examples/python/.venv/bin/python'), join(root, '.venv-python/bin/python')].find((p) => existsSync(p)) ??
  'python3';
const withNode = !args.includes('--no-node');

if (new URL(endpoint).port === '4300' && !args.includes('--main')) {
  console.error(`Refusing to send sample data to ${endpoint} (the main server). Pass --main if you really mean it.`);
  process.exit(2);
}

const PORTS = { catalog: 3011, inventory: 3012, providers: 3013, express: 3031, nest: 3032, shipping: 3033 };
const env = {
  ...process.env,
  STACKLENS_ENDPOINT: endpoint,
  BILLING_URL: `http://localhost:${PORTS.nest}`,
  SHIPPING_URL: `http://localhost:${PORTS.shipping}`,
  CATALOG_URL: `http://localhost:${PORTS.catalog}`,
  EXPRESS_URL: `http://localhost:${PORTS.express}`,
};

const children = [];
function start(name, cmd, cmdArgs, cwd, extraEnv = {}, { group = true } = {}) {
  const child = spawn(cmd, cmdArgs, { cwd, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const prefix = `[${name}] `;
  const log = (chunk) => {
    for (const line of String(chunk).split('\n'))
      if (line.trim() && /error|exception|traceback|listening|running on|started/i.test(line)) console.log(prefix + line);
  };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('exit', (code, signal) => {
    if (!stopping) console.log(`${prefix}exited (${signal ?? code})`);
  });
  child.signalGroup = group;
  children.push(child);
  return child;
}

const portOpen = (port) =>
  new Promise((ok) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('error', () => ok(false));
  });

async function waitFor(port, name, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${name} did not start on port ${port}`);
}

let stopping = false;
function stopAll() {
  stopping = true;
  for (const c of children) {
    try {
      // npm → node: signal the whole process group; run_all.py forwards the signal to its services itself
      process.kill(c.signalGroup ? -c.pid : c.pid, 'SIGINT');
    } catch {
      /* already gone */
    }
  }
}
process.on('SIGINT', () => (stopAll(), process.exit(130)));

async function main() {
  try {
    const health = await fetch(new URL('/api/health', endpoint));
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (e) {
    console.error(`No StackLens server answering at ${endpoint} (${e.message}). Start one first (see examples/python/README.md).`);
    process.exit(1);
  }
  for (const [name, port] of Object.entries(PORTS)) {
    if (!withNode && ['express', 'nest', 'shipping'].includes(name)) continue;
    if (await portOpen(port)) {
      console.error(`Port ${port} (${name}) is already in use – stop whatever runs there first.`);
      process.exit(1);
    }
  }

  console.log(`sending traces to ${endpoint}, Python: ${python}`);
  if (withNode) {
    start('shipping', 'npm', ['start'], join(root, 'examples/node/shipping-service'), { PORT: String(PORTS.shipping) });
    start('billing-api', 'npm', ['start'], join(root, 'examples/node/nestjs-typeorm'), { PORT: String(PORTS.nest) });
    start('orders-api', 'npm', ['start'], join(root, 'examples/node/express-basic'), { PORT: String(PORTS.express) });
  }
  start('python', python, [join(root, 'examples/python/run_all.py')], root, {}, { group: false });

  await waitFor(PORTS.catalog, 'catalog-api');
  await waitFor(PORTS.inventory, 'inventory-api');
  await waitFor(PORTS.providers, 'providers');
  if (withNode)
    await Promise.all([waitFor(PORTS.express, 'orders-api'), waitFor(PORTS.nest, 'billing-api'), waitFor(PORTS.shipping, 'shipping')]);
  await new Promise((r) => setTimeout(r, 2000)); // the Celery worker connects to its broker

  const traffic = spawn(python, [join(root, 'examples/python/traffic.py'), '--requests', String(requests), '--rps', String(rps)], {
    env,
    stdio: 'inherit',
  });
  const code = await new Promise((r) => traffic.on('exit', r));
  console.log('waiting for queued background tasks and trace export…');
  await new Promise((r) => setTimeout(r, 6000));
  stopAll();
  await new Promise((r) => setTimeout(r, 3000));
  console.log(code === 0 ? 'done' : `traffic exited with ${code}`);
  process.exit(code ?? 0);
}

main().catch((e) => {
  console.error(e.message);
  stopAll();
  process.exit(1);
});
