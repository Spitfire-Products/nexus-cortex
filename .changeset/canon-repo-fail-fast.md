---
"nexus-canon": minor
---

Fail-fast when no canon remote is configured. The built-in default remote URL is
REMOVED: auto-clone (sync/translate/pull/list/artifacts/graph, when no store
exists at the store path) now requires an explicitly configured remote —
`--repo-url` / `repoUrl` option or the `CANON_REPO` env var — and otherwise
throws a clear actionable error ("run `canon init <dir> --remote <url>`, or set
CANON_REPO"). A canon store is the user's own repo; an unconfigured environment
should get instructions, not an attempted clone of someone else's store URL.
Existing stores are unaffected (their `origin` remains the truth; push targets
never used the default).
