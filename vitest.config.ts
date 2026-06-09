import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'packages/archive/**',
      'tests/sandbox-transfer.test.mjs',
      'packages/cli/src/ink-ui/**/*.test.{ts,tsx}',
    ],
  },
});
