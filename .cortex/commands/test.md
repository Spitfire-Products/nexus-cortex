---
description: Run tests for a package and report results
argument-hint: [package-path]
---

Run the test suite at `$1`:

1. Execute `npm test -- --run` (or the appropriate test command) in the directory
2. Capture stdout and stderr
3. Report:
   - Total tests, passed, failed, skipped
   - For each failure: test name, expected vs actual, file location
   - Whether the failure is a real bug or a test issue

If no test command exists, check for `vitest`, `jest`, or `*.test.ts` files and run them directly.
