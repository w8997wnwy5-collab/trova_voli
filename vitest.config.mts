import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // `server-only` throws outside React Server Components; tests run engines directly.
      'server-only': path.resolve(import.meta.dirname, 'tests/support/server-only.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    env: { LOG_LEVEL: 'silent', MOCK_LATENCY_MS: '0-0', TZ: 'UTC' },
    testTimeout: 20000,
  },
});
