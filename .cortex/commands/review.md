---
description: Code review a file or directory with actionable feedback
argument-hint: [file-or-directory-path]
---

Review the code at `$1` with focus on:

1. **Bugs and logic errors** — anything that would cause incorrect behavior
2. **Security issues** — injection, auth bypass, data exposure
3. **Performance** — obvious inefficiencies, N+1 patterns, unnecessary allocations
4. **Readability** — unclear naming, missing context, overly complex logic

For each issue found, report:
- File and line number
- What's wrong
- A concrete fix (show the corrected code)

Skip style/formatting nits. Only report issues that matter.
