#!/usr/bin/env node
/**
 * Runs before `npm run dev` (stacklens/frontend "predev").
 *
 * Cloud-synced folders (iCloud Desktop & Documents, Dropbox, OneDrive, Google Drive) fight with
 * dev servers: they create conflict copies such as "src/lib 2" or "BUILD_ID 2" and touch files
 * while the watcher is running, which makes Next.js rebuild and reload pages in a loop.
 *
 * This script
 *  1. removes EMPTY conflict-copy folders ("<name> 2", "<name> 3", …) from the source trees,
 *  2. on macOS, flags generated folders (.next, node_modules, dist…) so iCloud never syncs them, and
 *  3. warns when the repo lives inside a cloud-synced folder.
 * It never deletes anything that contains files.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFLICT = / \d+(\.[^/]*)?$/;
const SKIP = new Set(['node_modules', '.git', '.next', '.next.nosync', 'dist', 'coverage']);

function removeEmptyConflictDirs(dir, removed) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    removeEmptyConflictDirs(full, removed);
    if (CONFLICT.test(e.name)) {
      try {
        fs.rmdirSync(full); // only succeeds when empty
        removed.push(path.relative(root, full));
      } catch {
        /* not empty: leave it for a human */
      }
    }
  }
}

function cloudSyncedBy(dir) {
  const real = fs.realpathSync(dir);
  if (real.includes('/Library/Mobile Documents/')) return 'iCloud Drive';
  const m = /\/Library\/CloudStorage\/([^/-]+)/.exec(real);
  if (m) return m[1];
  if (/\/(Dropbox|OneDrive[^/]*|Google Drive)\//.test(real)) return real.match(/\/(Dropbox|OneDrive[^/]*|Google Drive)\//)[1];
  if (process.platform !== 'darwin') return null;
  // iCloud "Desktop & Documents" keeps the normal paths but tags the folders with file-provider attributes.
  const home = os.homedir();
  for (let d = real; d.startsWith(home) && d !== home; d = path.dirname(d)) {
    try {
      const attrs = execFileSync('xattr', [d], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (/com\.apple\.(fileprovider|file-provider-domain-id|icloud)/.test(attrs)) return 'iCloud Drive (Desktop & Documents)';
    } catch {
      /* xattr unavailable */
    }
  }
  return null;
}

const removed = [];
for (const top of ['stacklens', 'packages', 'sdks', 'examples', 'deploy', 'scripts', 'docs', '.github'])
  removeEmptyConflictDirs(path.join(root, top), removed);
if (removed.length) console.log(`[stacklens] removed ${removed.length} empty sync-conflict folder(s): ${removed.join(', ')}`);

/**
 * macOS File Provider (iCloud Drive) skips items carrying this extended attribute, whatever their
 * name. Setting it keeps build output and dependencies local, so the watcher never sees sync churn.
 */
const IGNORE_ATTR = 'com.apple.fileprovider.ignore#P';
function excludeFromSync(dirs) {
  if (process.platform !== 'darwin') return [];
  const flagged = [];
  for (const rel of dirs) {
    const dir = path.join(root, rel);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const has = execFileSync('xattr', [dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes(IGNORE_ATTR);
      if (!has) {
        execFileSync('xattr', ['-w', IGNORE_ATTR, '1', dir], { stdio: 'ignore' });
        flagged.push(rel);
      }
    } catch {
      /* xattr missing or not permitted: the warning below still applies */
    }
  }
  return flagged;
}

function listDirs(rel) {
  try {
    return fs
      .readdirSync(path.join(root, rel), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch {
    return [];
  }
}

const provider = cloudSyncedBy(root);
if (provider) {
  const generated = [
    'node_modules',
    'stacklens/frontend/.next',
    'stacklens/frontend/.next.nosync',
    ...['stacklens/frontend', 'stacklens/backend'].map((d) => `${d}/node_modules`).filter((rel) => fs.existsSync(path.join(root, rel))),
    // packages/* and sdks/* (built to dist), examples/<language>/* (node_modules only)
    ...['packages', 'sdks', ...listDirs('examples').map((d) => `examples/${d}`)].flatMap((top) =>
      listDirs(top)
        .flatMap((name) => [`${top}/${name}/dist`, `${top}/${name}/node_modules`])
        .filter((rel) => (!top.startsWith('examples/') && rel.endsWith('/dist')) || fs.existsSync(path.join(root, rel))),
    ),
  ];
  const flagged = excludeFromSync(generated);
  if (flagged.length) console.log(`[stacklens] excluded from ${provider} sync: ${flagged.join(', ')}`);
}
if (provider) {
  const y = (s) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s);
  console.warn(
    y(`
[stacklens] This repo is inside a folder synced by ${provider}:
            ${root}
  Build output and node_modules are excluded from sync, but source files are still synced and
  can get conflict copies. For the most reliable setup, move the repo to a folder that isn't
  synced, for example:
      mv "${root}" ~/Developer/
`),
  );
}
