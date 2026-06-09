import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/artifacts/**',
        '**/*.d.ts',
        '**/bin/**'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    },
    // Test file patterns
    include: ['tests/**/*.test.ts'],
    // Timeout for async tests
    testTimeout: 10000
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
});
