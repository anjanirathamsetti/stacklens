import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // `server-only` throws outside a React Server environment; tests run plain Node
      'server-only': path.resolve(__dirname, 'test/server-only-stub.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      STACKLENS_DATA_DIR: path.join(os.tmpdir(), `stacklens-test-${process.pid}`),
      STACKLENS_MAX_TRACES: '5',
      STACKLENS_MAX_ERROR_TRACES: '3',
      STACKLENS_MAX_SUMMARIES: '1000',
      STACKLENS_DB_POOL_MAX: '4',
    },
  },
});
