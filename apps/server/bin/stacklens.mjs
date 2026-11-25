#!/usr/bin/env node
/**
 * StackLens server CLI.
 *
 *   npx stacklens                     # http://localhost:4300
 *   npx stacklens --port 8080 --data-dir ./traces
 *
 * Runs the prebuilt Next.js production server shipped in this package.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: process.env.PORT ?? '4300' },
    host: { type: 'string', short: 'H', default: process.env.HOSTNAME ?? '0.0.0.0' },
    'data-dir': { type: 'string', default: process.env.STACKLENS_DATA_DIR },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
});

if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}
if (values.help) {
  console.log(`StackLens ${pkg.version} – trace collector and analyser UI

Usage: stacklens [options]

Options:
  -p, --port <port>       Port to listen on            (default 4300, env PORT)
  -H, --host <host>       Interface to bind            (default 0.0.0.0, env HOSTNAME)
      --data-dir <path>   Where traces are persisted   (default ~/.stacklens/data, env STACKLENS_DATA_DIR)
  -v, --version           Print the version
  -h, --help              Show this help

Point your apps at http://<host>:<port>/api/ingest (STACKLENS_ENDPOINT).
ServiceNow and retention settings: see the README.`);
  process.exit(0);
}

let nextBin;
try {
  nextBin = createRequire(join(pkgDir, 'package.json')).resolve('next/dist/bin/next');
} catch {
  console.error('[stacklens] could not find Next.js – reinstall the package.');
  process.exit(1);
}

const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
if (values['data-dir']) env.STACKLENS_DATA_DIR = resolve(values['data-dir']);

console.log(`StackLens ${pkg.version} → http://${values.host === '0.0.0.0' ? 'localhost' : values.host}:${values.port}`);
const child = spawn(process.execPath, [nextBin, 'start', pkgDir, '-p', values.port, '-H', values.host], { stdio: 'inherit', env });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
