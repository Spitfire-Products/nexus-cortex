---
"@nexus-cortex/executors": patch
"@nexus-cortex/cli": patch
---

Dependency hygiene: `@nexus-cortex/executors` moves from glob 10 to glob 13 (same API for the Glob/Grep/Skill/SlashCommand/Task tools; clears the npm deprecation warning on install) and `@nexus-cortex/cli` drops `node-fetch`, which it declared but never imported (Node's built-in fetch is used), removing one copy of the deprecated `node-domexception`. Remaining copies come from the Anthropic SDK 0.20.x pin and the Google auth chain and will go with those upgrades.
