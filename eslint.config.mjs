// Flat ESLint config (ESLint 9). Pragmatic gate for a large existing codebase: catch
// real bugs (the JS recommended set), let TypeScript own type-level checks, and don't
// flood on style. Tighten over time by promoting individual rules from warn -> error.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Real-bug rules (errors): no-dupe-keys, no-unreachable, no-cond-assign,
      // no-dupe-args, no-self-assign, no-debugger, no-fallthrough, etc.
      ...js.configs.recommended.rules,

      // TypeScript handles these far better than ESLint core — turn the core versions off.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-import-assign': 'off',

      // Pragmatic relaxations for this codebase (intentional patterns, not bugs):
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-async-promise-executor': 'warn',
      'no-case-declarations': 'warn',
      'no-cond-assign': ['error', 'except-parens'],
    },
  },
];
