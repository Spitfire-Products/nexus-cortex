import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 4.133.0: the shipped default is user-hybrid (browser MCP auto-connect); tests pin the pre-4.133 profile (same as publish.yml).
    env: { CORTEX_PROFILE: 'standard', CORTEX_TOOL_PARENT_DEPTH: '' },   // tests run from an agent's Bash must not inherit the nesting marker
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
  },
});
