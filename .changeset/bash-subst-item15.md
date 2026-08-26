---
"@nexus-cortex/executors": minor
---

Bash $() command-substitution guard fixes (backlog item 15, operator-ruled): (1) `$(( ))` arithmetic expansion is no longer flagged — the old substring check false-positived on arithmetic, which is not command substitution under any threat model; nested real substitution inside arithmetic (`$(( $(cmd) ))`) is still blocked. (2) New env lever `CORTEX_ALLOW_CMD_SUBSTITUTION=true` lifts the check entirely for sandboxed profiles (e.g. bench containers) — an operator decision, default off. (3) The denial message now teaches the accepted alternative (run the inner command separately, pass output via file/pipeline) instead of a bare refusal, cutting the denial→rewrite→variant loop that fed the near-dup class. Investigation context: the permissions layer never gated these calls headless (`headlessAutoApprove` → bypassAll), and backticks/`<()` were never checked — the $() block taxed the natural spelling without foreclosing substitution.
