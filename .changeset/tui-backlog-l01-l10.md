---
"@nexus-cortex/tui": patch
"@nexus-cortex/executors": patch
"nexus-canon": patch
---

TUI UX backlog fixes L-01 + L-10: /help renders inline in fuzzycortex instead of
mounting a second Ink root (closing help no longer ends the session; help now
scrolls in native scrollback), and the artifact-registry first-run INIT line is
debug-gated so it no longer appears inside the conversation frame. Rides with the
canon watcher-revival + recent-window fixes already on the train.
