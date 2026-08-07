---
"nexus-canon": minor
---

feat(canon): add browser-cortex as a fifth harness in the tool ontology

Completes the cross-harness tool-ontology (canonTools) so it covers ALL FIVE
harnesses that write to the canon store, adding the in-browser Nexus Terminal
CORTEX agent (`browser-cortex`) as a first-class `HarnessName` alongside
claude-code, nexus-cortex, grok-build, and gemini-cli.

- `TOOL_CONCEPTS` gains a `browser-cortex` mapping on every concept with a clean
  dedicated equivalent, using the verified `cortex_*` VFS tool family from
  nexus-terminal's `toolSeedData.ts` (2026-08-05): shell→cortex_bash,
  read_file→cortex_read, write_file→cortex_write, edit_file→cortex_edit,
  glob→cortex_glob, grep→cortex_grep, web_search→cortex_web_search,
  web_fetch→cortex_web_fetch, spawn_agent→dispatch_agent,
  tool_search→cortex_search_tools, skill→cortex_skill. Concepts with no clean
  browser equivalent (list_dir, todo, plan_mode) are omitted rather than invented.
- `ARG_MORPHISMS` gains a `browser-cortex` ArgMorph on each mapped concept.
  Browser CORTEX mirrors claude-code's arg dialect, so most are field-identical
  (no rename). edit_file→cortex_edit and shell→cortex_bash are `observed`
  (arg shapes confirmed against the tool schema; cortex_bash drops the PTY-only
  `run_in_background`); the rest are `spec` (name-confirmed from the registry).
