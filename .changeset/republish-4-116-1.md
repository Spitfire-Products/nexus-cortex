---
"nexus-cortex": patch
"@nexus-cortex/core": patch
"@nexus-cortex/executors": patch
"@nexus-cortex/server": patch
"@nexus-cortex/types": patch
"@nexus-cortex/cli": patch
"@nexus-cortex/tui": patch
"@nexus-cortex/meta": patch
---

Republish: the 4.116.0 publish left `@nexus-cortex/executors@4.116.0` stuck in npm's staged state (409 on retry), so exact-pinned installs of nexus-cortex@4.116.0 fail with ETARGET. No code changes; every package moves to 4.116.1.
