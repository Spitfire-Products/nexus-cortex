import { defineConfig } from 'vitest/config';

// Tests of components EXCLUDED from the tsc build (unported upstream ink-ui
// source — see tsconfig.json "exclude") must not be collected either.
export default defineConfig({
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
