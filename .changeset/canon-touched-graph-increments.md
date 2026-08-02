---
"nexus-canon": minor
---

feat(canon): the history↔code semantic join — session→file `touched` edges, graphify auto-detect, and cross-project routing.

- **Touched edges**: `canonGraph` now scans canon session content (streaming, parts-aware; incremental via `~/.canon/touched-cache.json` — 2,570 sessions ≈ 20s first scan, ~1s cached) extracting the file paths each session's tool calls touched, and emits `sess → file` `touched` edges (EXTRACTED / 1.0, weight = touch count, provenance = the canon session path). Targets prefer the code half's file-level node, else a lightweight `file:` node — no touch is dropped. Default on; `--no-touched` to skip.
- **graphify auto-detect (mode A automatic)**: each project's `graphify-out/graph.json` (from `graphify update <root>`) is folded into that project's graph automatically; `--merge-graph` remains as explicit override. Merged graphs record `graph.code_half` provenance.
- **Cross-project routing**: touched edges route to the *owning* project by longest-root-match (project roots nest); a session homed elsewhere gets a marked foreign `sess:` node (`foreign_home`) — cross-project work is first-class. Dual-lineage sessions (pull = branch) are handled correctly: the touched index is keyed by session path (uuids repeat across lineages) and same-uuid edges dedupe at max weight.
