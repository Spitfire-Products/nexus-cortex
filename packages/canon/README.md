# nexus-canon

**Portable agent memory in a git repo you own.**

Canon stores agent sessions in a provider-neutral, lossless, append-only canonical
format and translates at the edges — so the same history serves any model, any
provider, and any harness. This package is the standalone pipeline: scaffold a
store, sync native harness session files into it, maintain the canonical line,
and pull sessions back out wherever you want to resume. Capability artifacts
(skills, agents, MCP configs) and project-scoped knowledge graphs ride the same
store — graphs join the history and code halves in one NetworkX node-link file:
session→file `touched` edges scanned from tool-call content, plus an
auto-detected [graphify](https://github.com/Graphify-Labs/graphify) code graph
when present, every edge confidence-tagged.

```bash
npm i -g nexus-canon
nexus-canon init my-canon --remote <private-repo-url>
nexus-canon sync && nexus-canon translate
nexus-canon list
nexus-canon pull <session-uuid> --to .cortex/sessions
nexus-canon watch          # daemon: auto-sync on any session-file change
```

**Keep the store current automatically.** `watch` fs-watches every declared
harness session root (Claude Code, grok, gemini, cortex — built-in defaults
plus `HARNESSES.json` overrides) and runs a debounced `sync` whenever a session
file changes; an initial catch-up sync fires at startup. Run it in the
background (`nexus-canon watch &`), and/or add a cron catch-up for gaps when
nothing is running (`41 */6 * * * nexus-canon sync && nexus-canon translate` —
sync is idempotent and manifest-diffed, so runs are cheap). Inside the
nexus-cortex harness there is additionally a per-turn hook: `cortex config set
CANON_AUTO_SYNC true` schedules the same debounced sync after every completed
turn.

Dependency-free (Node built-ins; canonical record types from
`@nexus-cortex/types`). The [nexus-cortex](https://www.npmjs.com/package/nexus-cortex)
harness embeds this same package as `cortex canon <verb>` — one implementation
everywhere.

**Spec:** [docs/CANON.md](https://github.com/Spitfire-Products/nexus-cortex/blob/main/docs/CANON.md)
— the record format, the contract (store once / translate at the edge /
append-only / provenance recorded), the artifact dimension, and honest scope.

License: Apache-2.0.
