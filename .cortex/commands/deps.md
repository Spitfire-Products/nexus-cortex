---
description: Analyze dependencies and imports for a file or package
argument-hint: [file-or-package-path]
---

Analyze the dependency graph for `$1`:

1. Read the file(s) and extract all imports
2. Trace each import to its source (local file, package, or node built-in)
3. Report:
   - Direct dependencies (what this file imports)
   - Reverse dependencies (what imports this file — use grep)
   - Any circular dependencies detected
   - Unused imports (imported but not referenced in code)
   - Missing dependencies (referenced but not imported)
4. If analyzing a package.json, check for unused or outdated packages
