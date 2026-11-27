import path from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

/** Monorepo root. Pinned so Next doesn't pick up a stray lockfile higher up (e.g. ~/package-lock.json). */
const workspaceRoot = path.join(__dirname, '../..');

const config = (phase: string): NextConfig => ({
  /** Self-contained server bundle for the Docker image (deploy/docker/Dockerfile sets STACKLENS_STANDALONE=1). The npm CLI uses `next start`. */
  output: process.env.STACKLENS_STANDALONE === '1' ? 'standalone' : undefined,
  reactStrictMode: true,
  /** Workspace packages ship TypeScript sources; Next compiles them with the app. */
  transpilePackages: ['@stacklens/backend', '@stacklens/shared'],
  /** Native/WASM database drivers are loaded from node_modules at runtime, not bundled. */
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  /** PGlite loads its WASM + data files at runtime; make sure the standalone bundle carries them. */
  outputFileTracingIncludes: {
    '/api/**/*': ['../../node_modules/@electric-sql/pglite/dist/**/*'],
  },
  poweredByHeader: false,
  devIndicators: false,
  /**
   * `next dev` writes to `.next.nosync`. Cloud-synced folders (iCloud Desktop & Documents, and
   * others that honour the `.nosync` suffix) otherwise upload the build output while it is being
   * written and leave conflict copies such as `BUILD_ID 2`, which break the dev server's
   * live-reload handshake and reload every page in a loop. Production builds keep `.next`, which
   * the Docker image and the npm package expect. NEXT_DIST_DIR overrides both.
   */
  distDir: process.env.NEXT_DIST_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? '.next.nosync' : '.next'),
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  experimental: {
    // Next 16's dev MCP server mirrors browser console output into .next/dev/logs. With the
    // workspace root pinned, Turbopack watches that file, so every page load triggered a
    // rebuild → reload → log write loop. StackLens doesn't use the MCP integration.
    mcpServer: false,
  },
  async redirects() {
    return [{ source: '/insights', destination: '/hotspots', permanent: true }];
  },
});

export default config;
