---
description: Deep search the codebase for a concept, pattern, or usage
argument-hint: [search-term-or-pattern]
---

Search the codebase thoroughly for: $1

1. Grep for the exact term across all source files
2. Search for related terms (aliases, similar names, abbreviations)
3. For each match, read enough context to understand usage
4. Categorize findings:
   - Definitions (where it's defined/declared)
   - Usage (where it's called/referenced)
   - Configuration (where it's configured/set)
   - Tests (where it's tested)
5. Summarize: what is it, where does it live, how is it used
