# Canon — the canonical agent history & memory store

**Canon** is Nexus Cortex's answer to a problem the field now calls *portable agent
memory* or *cross-harness handoff*: agent context locked inside one vendor's runtime
dies there. Canon stores every session in a provider-neutral, lossless, append-only
JSONL format and translates **at the edges** — so the same history serves any model,
any provider, and (by design) any harness.

Canon shipped inside this library before the problem had a name. It was built to solve
three production failures at once — context ballooning, prompt-cache misses, and the
inability to switch models mid-session — and all three turn out to be one failure:
*storing history in a provider's wire format.* Canon fixes the storage; everything
else follows.

## The contract

1. **Store once, in a superset.** Every message is written in the canonical format —
   never a provider wire format. Text, thinking/reasoning spans, tool calls with full
   arguments, tool results, system events, and compaction boundaries are all
   first-class records. Nothing is lost at write time.
2. **Translate at the edge, per consumer.** The Gateway Translation Layer + format
   adapters render canonical history into each provider's exact dialect at request
   time (and translate responses back). The store never bends toward any provider.
3. **Append-only, with structure.** One JSON object per line. History is never
   rewritten: compaction inserts a `CompactBoundary` record and threads
   `logicalParentUuid` past it, so the full pre-compaction history remains one seek
   away. Branches are first-class (`parentUuid` graphs, `branchPoint`/`resumePoint`).
4. **Provenance is recorded, not implied.** Each assistant message carries the model
   that produced it (`model.id`, `model.provider`, `model.apiPattern`) and its token
   usage/cache accounting. A session that switched models mid-way says so, per
   message.

## What this buys you

- **Mid-session model switching** — history is neutral; switching providers is
  choosing a different render function, not a migration.
- **Prompt-cache stability** — deterministic rendering of a stable canonical prefix
  yields byte-stable provider prefixes; cache hits survive session evolution.
- **Context control without destruction** — curation and budgeting are render-time
  policies over immutable history, not edits to it.
- **Cross-harness portability** — the same properties that let one orchestrator serve
  many providers let many harnesses share one history. Sessions from external
  harnesses (e.g. Claude Code's session format) are convertible to canon and back;
  format adapters are the only per-harness cost.
- **Training-grade fidelity** — because nothing is dropped at write time, canonical
  history doubles as a faithful substrate for downstream analysis or fine-tuning
  pipelines, with privacy transforms applied at *export* time, never at capture.

## The record format

Storage layout: `{baseDir}/{normalized-workspace-path}/{sessionUuid}.jsonl`, one
complete JSON message object per line, append-only (default `baseDir`:
`.cortex/sessions/`).

Message union (`packages/core/src/session/MessageTypes.ts`):

```
Message = UserMessage | AssistantMessage | SystemMessage
        | ToolUseMessage | ToolResultMessage | FileHistorySnapshotMessage
```

Every message extends `BaseMessage`:

| Field | Purpose |
|---|---|
| `uuid`, `timestamp` | identity; ISO 8601 |
| `parentUuid` | threading / branch graphs |
| `logicalParentUuid` | threads past compaction boundaries |
| `timeline.{sessionId, conversationId, turnNumber}` | position |
| `timeline.{checkpointId, branchPoint, resumePoint}` | branching & resume markers |
| `model.{id, provider, apiPattern}` | per-message provenance |
| `usage.{inputTokens, outputTokens, cache…, costUsd…}` | accounting |

`CompactBoundary` is a `SystemMessage` subtype (`subtype: 'compact_boundary'`)
carrying compaction metadata — compaction is an *event in* history, not an edit *of*
history.

Two optional extensions ride the record format:

- **`jspaceState?`** (assistant turns) — the agent's per-turn "state of mind" in
  canonical cluster space: `{ lensId, basisVersion, summary: number[],
  trajectoryRef?, agreement? }`. The inline summary keeps the store light; full
  per-token trajectories ride the blob tier (`trajectoryRef`), encrypted-at-rest for
  repo-backed canon. Optional and non-breaking by construction; state trails are
  partial model internals and are gated before any public exposure.
- **`ArtifactManifest`** — canon's *second* canonical record kind, for capability
  artifacts (skills, agents, MCP configs, plugins) and the intent layer (projects,
  plans): versioned document/config bundles that deliberately do **not** use the
  Message schema. A manifest records `{ kind, id, version, content[], provenance,
  harnessCompat?, projectionRules?, state? }` with blob-addressed content; artifacts
  are translated between harnesses by per-kind *layout* adapters, never by the
  message gateway. Derived, project-scoped knowledge graphs (`graph.json`, NetworkX
  node-link with per-edge confidence tagging) consume both record kinds.

The shared canonical message type lives in `@nexus-cortex/types`
(`packages/types/src/messages.ts`); the store implementation is
`packages/core/src/session/JSONLHistoryStore.ts`.

## The translation layer

`packages/core/src/adapters/`:

- `GatewayTranslationLayer.ts` — orchestrates bidirectional canonical⇄provider
  conversion for messages and tools.
- Format adapters per API family: `MessagesAPIAdapter` (Anthropic),
  `ChatCompletionsAPIAdapter` (OpenAI-compatible), `ResponsesAPIAdapter`
  (OpenAI/xAI Responses), `GenerateContentAPIAdapter` / `GoogleGenAPIAdapter`
  (Google), registered through `AdapterRegistry`.
- `ToolNamingHandler` — tool-name normalization across providers' naming rules.

Adapters own the *deliberate* lossy projections (e.g. a provider that cannot accept
another provider's signed reasoning blocks): what cannot be replayed is dropped or
transformed at render time, never at storage time.

## Using canon from the CLI

The pipeline ships as the `cortex canon` verb suite (run `cortex canon --help` for
options; every verb accepts `--store <dir>` and most accept `--dry-run` / `--json`):

```bash
cortex canon init my-canon --remote <private-repo-url>
                        # scaffold a store: directory taxonomy, .gitattributes
                        # (jsonl merge=union), verification workflow, README
cortex canon sync       # copy changed native harness sessions into the store,
                        # secret-scrubbed, one debounced commit + push
cortex canon translate  # maintain the canonical line: /native → /canon +
                        # /projections (deterministic, incremental)
cortex canon list [--project <id>] [--all]
                        # sessions with size, origin harness, recovered title
cortex canon pull <uuid> [--to <dir>] [--force] [--target <harness>]
                        # materialize a session into a native session dir —
                        # a BRANCH of the canonical line, never a clobber.
                        # Prints the tool-ontology compatibility report:
                        # which referenced tools are native / name-mapped /
                        # MCP / unmapped for the receiving harness, with
                        # rung-2 arg fidelity per mapped tool ([args observed],
                        # [args observed; drops: ...], [args unverified]).
                        # Also writes the rung-4 TOOL CAPSULE next to the
                        # pulled session (<uuid>.tools.md): the report + the
                        # original calls of every unmapped/MCP tool, so the
                        # receiving model can re-express intent against its
                        # LOCAL tool menu. Capsule = untrusted input.
cortex canon artifacts  # capture skills/agents/mcp/plugins/plans/projects as
                        # ArtifactManifest records + store taxonomy bytes
cortex canon tools [--json]
                        # observed tool inventory per harness (scanned from
                        # the canonical line) + the cross-harness concept map.
                        # Rung 2 (library API): `morphToolCall(call, source,
                        # target)` re-expresses one tool call in the target
                        # harness's arg dialect via ARG_MORPHISMS — renames
                        # applied, unsupported fields DROPPED (reported, never
                        # silent), evidence graded observed/spec/unverified.
                        # Morphisms are empirically seeded from the real
                        # four-harness corpus; consumers: the pull report
                        # today, the rung-3 relay next.
cortex canon graph [--project <id>] [--merge-graph <graph.json>] [--no-touched]
                        # derive project-scoped knowledge graphs (node-link,
                        # per-edge confidence). Two halves in one graph: the
                        # HISTORY half (sessions, artifacts, and session->file
                        # `touched` edges scanned from tool-call content —
                        # incremental, cached) and the CODE half (a graphify
                        # graph.json at <project-root>/graphify-out/ is folded
                        # in automatically; --merge-graph overrides). Cross-
                        # project touches route to the owning project's graph.
cortex canon watch [--debounce <ms>] [--dry-run]
                        # long-running watcher: fs-watch every declared harness
                        # session root and auto-run `sync` (debounced, default
                        # 60s) whenever a session file changes. Initial catch-up
                        # sync at startup; Ctrl-C to stop. Also on the
                        # standalone bin: `nexus-canon watch`.
```

Typical loop: `init` once → `sync && translate` on a schedule (cron-friendly:
both are idempotent and incremental) → `pull` wherever you want to resume. The
same functions are exported from `@nexus-cortex/core`
(`canonSync`/`canonTranslate`/`canonPull`/`canonArtifacts`/`canonGraph`) for
embedding — the CLI and any scheduler run one implementation.

## Keeping the store current (reactive capture)

Manual `canon sync` still works, but the store can keep itself current. Two
reactive triggers ride the same `canonSync()` spine — both **opt-in** (a sync
commits and pushes to your canon remote, so nothing fires until you turn it on):

**1. The turn hook (your own cortex sessions).** After each completed cortex
turn, the orchestrator schedules a debounced sync — a burst of turns collapses
into one commit. Best-effort and fire-and-forget: a capture failure never
affects the turn. Activate after install:

```bash
cortex config set CANON_AUTO_SYNC true          # hot-applies, no restart
cortex config set CANON_AUTO_SYNC_DEBOUNCE_MS 60000   # optional (default 60s)
cortex config set CANON_STORE /tmp/canon-store  # optional (this is the default)
cortex config set CANON_REPO <your-store-remote-url>  # optional override
```

All four live in `cortex config category session` and persist to `~/.cortex/.env`.

**2. `cortex canon watch` (everything else on disk).** Sessions written by
*other* processes — Claude Code, grok, gemini, another machine syncing into a
shared root — never pass through your orchestrator's turn loop. The watcher
covers them: it fs-watches every declared harness root (the same built-in +
`HARNESSES.json`-driven list `sync` uses) and fires the same debounced sync on
any change. Run it as a background daemon:

```bash
cortex canon watch &          # or: nexus-canon watch (standalone install)
```

**3. Cron fallback (catch-up while nothing is running).** Both triggers only
fire while a process is alive. For gaps (reboots, idle machines), schedule the
classic catch-up — `sync` is idempotent and diffs against a persistent
mtime/size manifest, so an occasional run captures exactly what changed:

```bash
# crontab: every 6 hours
41 */6 * * * cortex canon sync && cortex canon translate
```

A typical always-current setup after `npm i -g nexus-cortex`: `canon init` once,
`config set CANON_AUTO_SYNC true` once, `canon watch` in the background (or the
cron line), done — every harness's sessions flow into the store as they happen.

**Configuring the store:** `HARNESSES.json` (store root) declares what `sync`
captures — one entry per harness, config not code; `projects/ROOTS.json`
overrides the derived project↔session map (roots / claudeDirs / cortexLabels)
for dash-ambiguous paths or sessions from other machines. Both are scaffolded
by `canon init` with inline documentation.

**Onboarding a new harness:** capture is one `HARNESSES.json` entry; the
translation adapter is the one per-harness task — protocol, defect-class
catalog, and acceptance bar in **[HARNESS_ONBOARDING.md](HARNESS_ONBOARDING.md)**.

## Scope, honestly

Canon fully solves the **transcript** layer of cross-harness portability. Three
adjacent layers are explicitly out of scope of the store itself and are addressed (or
tracked) separately:

- **Tool namespace** — a transcript referencing tools the receiving harness lacks is
  faithfully carried but not automatically executable there; mapping tool ontologies
  is its own layer.
- **Distilled memory** — derived memory files ride alongside history and are portable
  as plain markdown, but distillation policy is harness-specific.
- **Harness contract** — system prompts, permissions, and skills are not part of
  history; handoffs that depend on them need explicit context capsules.

## Direction

The roadmap extends canon from a per-harness store to a **user-owned, cross-harness
hub**: a git repository as the portable canon backend (agents push their native
session formats; CI runs the gateway to maintain the canonical line and
per-harness projections), with real-time database backends as an alternative tier
for live multi-agent workloads. The design keeps one rule fixed: the gateway and
adapters live in this library and execute wherever canon lives — the format never
forks.
