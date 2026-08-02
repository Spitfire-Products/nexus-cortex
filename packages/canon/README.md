# nexus-canon

**Portable agent memory in a git repo you own.**

Canon stores agent sessions in a provider-neutral, lossless, append-only canonical
format and translates at the edges — so the same history serves any model, any
provider, and any harness. This package is the standalone pipeline: scaffold a
store, sync native harness session files into it, maintain the canonical line,
and pull sessions back out wherever you want to resume. Capability artifacts
(skills, agents, MCP configs) and project-scoped knowledge graphs ride the same
store.

```bash
npm i -g nexus-canon
nexus-canon init my-canon --remote <private-repo-url>
nexus-canon sync && nexus-canon translate
nexus-canon list
nexus-canon pull <session-uuid> --to .cortex/sessions
```

Dependency-free (Node built-ins; canonical record types from
`@nexus-cortex/types`). The [nexus-cortex](https://www.npmjs.com/package/nexus-cortex)
harness embeds this same package as `cortex canon <verb>` — one implementation
everywhere.

**Spec:** [docs/CANON.md](https://github.com/Spitfire-Products/nexus-cortex/blob/main/docs/CANON.md)
— the record format, the contract (store once / translate at the edge /
append-only / provenance recorded), the artifact dimension, and honest scope.

License: Apache-2.0.
