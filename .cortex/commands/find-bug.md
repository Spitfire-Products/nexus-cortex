---
description: Investigate a bug from an error message or symptom
argument-hint: [error-message-or-symptom]
---

Investigate this bug: $1

1. Search the codebase for the error message or related code
2. Read the relevant source files
3. Trace the execution path that leads to the error
4. Identify the root cause (not just the symptom)
5. Propose a fix with the exact code change needed
6. Check if the fix could break anything else (grep for callers/dependents)
