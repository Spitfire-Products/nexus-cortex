---
"nexus-cortex": patch
"@nexus-cortex/core": patch
"@nexus-cortex/cli": patch
---

Release fix: document the harness-set `CORTEX_ANTHROPIC_KEY_NOTE` (the reason an Anthropic subscription OAuth token in `ANTHROPIC_API_KEY` was not used as an API key) so the publish workflow's env-docs check passes. 4.131.0 was tagged but never published; 4.131.1 carries everything listed under 4.131.0.
