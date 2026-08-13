---
"nexus-canon": patch
---

canon: centralize git exec (`canonGit` in canonRepo) — auth + commit identity + piped stderr on EVERY canon verb, not just sync. Fixes hosted-container `Author identity unknown` failures (and their PTY stderr leak) from canon-translate and canon-graph commits, adds token auth to translate/graph/artifacts/pull clones+pushes, and redacts repo URLs in all clone log lines.
