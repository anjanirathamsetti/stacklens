import path from 'node:path';
import type { NextConfig } from 'next';

/** Monorepo root. Pinned so Next doesn't pick up a stray lockfile higher up (e.g. ~/package-lock.json). */
const workspaceRoot = path.join(__dirname, '../..');

const nextConfig: NextConfig = {
  /** Self-contained server bundle for the Docker image (docker/Dockerfile sets STACKLENS_STANDALONE=1). The npm CLI uses `next start`. */
  output: process.env.STACKLENS_STANDALONE === '1' ? 'standalone' : undefined,
  reactStrictMode: true,
  /** Native/WASM database drivers are loaded from node_modules at runtime, not bundled. */
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  /** PGlite loads its WASM + data files at runtime; make sure the standalone bundle carries them. */
  outputFileTracingIncludes: {
    '/api/**/*': ['../../node_modules/@electric-sql/pglite/dist/**/*'],
  },
  poweredByHeader: false,
  devIndicators: false,
  /** Lets a second build run alongside `next dev` without clobbering it. */
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
};

export default nextConfig;
