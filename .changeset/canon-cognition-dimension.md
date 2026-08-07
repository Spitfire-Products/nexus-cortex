---
"nexus-canon": minor
---

feat(canon): §27l graph cognition dimension — fold agent reasoning into the project graph

Adds an opt-in COGNITION half to the canon knowledge graph, a sibling to the
existing HISTORY (sessions/artifacts/`touched`) and CODE (graphify) halves,
joined on `session_id + turn` (the same join discipline `source_file` uses).

- New `extractCognition` (pure) emits one `thought` node per reasoning-bearing
  turn plus three confidence-tagged edges: `thought → tool_call` (EXTRACTED 1.0,
  same-turn), `thought → source_file` (INFERRED 0.5, transitive via that tool
  call's file input), and `thought → thought` continuity (INFERRED 0.5) between
  consecutive reasoning turns.
- Gated behind `canonGraph({ cognition: true })` / `canon graph --cognition`
  (default OFF → default graph output byte-identical).
- SENSITIVITY: thought nodes carry ONLY structural/derived data by default —
  session_id, turn, block_type, char/token counts, and a secret-scrubbed
  ~80-char label. Raw thinking text is emitted only under the explicit
  `includeThoughtText` / `--include-thought-text` opt-in, and is scrubbed too.
  Every content-derived string routes through the same push-boundary
  `scrubSecrets` (now exported from canonSync) the store already applies, so a
  thought node can never be a leak vector in a shareable graph.
