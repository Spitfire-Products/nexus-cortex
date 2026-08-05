---
"nexus-canon": minor
---

Browser-branch integration in `canon sync`. Browser SPAs push their canon
capture to per-client `browser-cortex-<id>` branches (their in-browser repos
have unrelated history and must never force main). `canonSync` now folds each
such branch's `/native/browser-cortex/` tree into main's working tree
(ls-remote → shallow fetch → path checkout) before the commit+push, so browser
sessions flow into the canonical line automatically on every sync/watch/cron
cycle. Tolerant of zero branches and per-branch failures (visible warnings).
