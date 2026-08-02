---
"@nexus-cortex/core": minor
---

feat(session): the harness now records file-history snapshots. File-mutating tool calls (Write/Edit) mark files in the (previously dormant) `FileCheckpointManager`; each tool batch that mutated files backs them up content-addressably under `.cortex/sessions/file-history/<sessionId>/` and appends a `file-history-snapshot` record (`snapshot.trackedFileBackups`) to the session JSONL — Claude Code parity. Disk-only: the record never enters provider-facing message history. Canon's `touched` graph edges consume these snapshots as EXTRACTED-grade write evidence.
