---
description: Analyze uncommitted changes and summarize what was modified
argument-hint: [path-or-empty]
---

Analyze the current git diff in the working directory $1:

1. Run `git diff` and `git diff --cached` to see all changes
2. Run `git status` to see untracked files
3. For each changed file, summarize:
   - What was added/removed/modified
   - Whether the change looks correct
   - Any potential issues introduced
4. Suggest a commit message that accurately describes the changes
