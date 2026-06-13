# Nexus Cortex — Architecture

How the harness fits together: the monorepo layout, the orchestrator, the provider/tool/
middleware systems, and the other core subsystems. For usage see the [User Guide](user-guide.md).

## Monorepo structure

```
nexus-cortex/
├── packages/
│   ├── types/              # Shared TypeScript types (zero runtime deps)
│   ├── core/               # Core orchestration library
│   │   ├── orchestrator/   # CortexOrchestrator (main engine) + sub-agents
│   │   ├── adapters/       # Format adapters (Messages, ChatCompletions, …)
│   │   ├── models/         # Model registry (per-provider model cards)
│   │   ├── tools/          # Tool definitions & registries
│   │   ├── middleware/     # System-message, permissions, retry, mentorship, …
│   │   ├── training/       # Auto-research: experiments, router matrix, gate
│   │   ├── mcp/            # MCP client & server integration
│   │   ├── system-messages/# System message auto-loading
│   │   └── session/        # JSONL session storage
│   ├── executors/          # Tool execution implementations
│   ├── server/             # Express HTTP server (optional)
│   │   └── routes/         # REST API endpoints
│   └── cli/                # Headless cortex CLI
└── scripts/                # Build and maintenance scripts
```

### Package build order

A strict order, because core and executors form a circular dependency broken by a two-pass
build (handled by `scripts/build.sh`):

1. **types** — shared types (zero deps)
2. **executors** — partial build (core imports fail; expected)
3. **core** — depends on types
4. **executors** — complete build (core now available)
5. **server** — depends on core
6. **cli** — headless `cortex` (depends on core)
7. **tui** — interactive React/Ink + Chalk UIs (Release 2 — not yet published)

Always build from the repo root: `npm run build`.

### Direct-wired vs server mode

**Direct mode (default)** — the core library is imported directly into the CLI process: zero
network overhead, immediate access to all orchestrator features, single-process debugging.

**Server mode (optional)** — an HTTP server exposes the REST API for web/mobile/remote clients
and multi-client use.

## Core systems

### Cortex Orchestrator

The orchestrator coordinates every AI interaction, tool execution, and session update. A
single `processMessage` turn handles periodic review, keyword detection, system-message
injection, context budgeting, model selection, the API call (with retry and context-rejection
compaction), the tool-calling loop (with loop detection and orphaned-tool recovery), cache-
metric extraction, and session persistence.

```typescript
import { CortexOrchestrator } from '@nexus-cortex/core';

const orchestrator = new CortexOrchestrator({
  modelId: 'claude-sonnet-4-6',
  projectPath: process.cwd(),
  mcpAutoInject: true,
});

const response = await orchestrator.processMessage({ role: 'user', content: 'Analyze this codebase' });
```

### Multi-provider system

Providers are reached through a pluggable adapter layer (Messages, Chat Completions,
GenerateContent, GenAI, Responses). Each provider is enabled by its API key. The **five major
labs are proven end-to-end** (driven hard through the full tool loop, sub-agents, caching, and
the benchmark harness); the smaller labs (Cloudflare Workers AI, Zhipu/GLM, Qwen, Moonshot/Kimi,
MiniMax, Mercury) are incorporated through the same adapters but treated as preview.

**Run `cortex models list` for the live, exact set** — and `cortex models providers` for the
provider list with the API-key variable each needs.

### Tool system

A dual registry — immutable base tools + dynamic addon tools — plus any tools discovered from
connected MCP servers, all with read-before-edit safety. Categories: file & notebook, search,
shell (foreground + background), web & browser, sub-agents, git & PR, sandboxed artifacts with
React introspection, conversation history, MCP/tool discovery, planning & UI, code & monitoring,
auto-research, skills & commands, and an opt-in end-of-turn audit.

**Run `cortex tools list` for the live, authoritative set with descriptions.**

### System message management

System messages auto-load from `.cortex/CORTEX.md` (project context) and numbered files under
`.cortex/system-messages/`. `CORTEX.md` is generated on demand:

```bash
/init                                  # in the CLI
# or programmatically:
import { InitCortexContext } from '@nexus-cortex/core';
await InitCortexContext.execute({ scope: 'auto', max_depth: 5 }, process.cwd());
```

It captures the project description, file tree, dependency analysis (npm/Python/Rust/Go),
available scripts, and monorepo package structure.

### MCP integration

Full Model Context Protocol support. Manage via `cortex mcp …` (or `/mcp` in the UI); configure
in `.cortex/mcp_config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
    }
  }
}
```

### Session management

JSONL-based persistence with full state recovery: append-only JSONL in `.cortex/sessions/`,
UUID message IDs (zero collision risk), content-addressable file checkpoints in
`.cortex/file-history/`, helper-model auto-compaction at a configurable token threshold, and
optional auto-resume on server start.

### Sandboxed artifacts & visual workspace

`CreateArtifactTool` spins up a runnable web/server app in a tmux-managed sandbox and the model
iterates against it with real feedback: snapshots (screenshot/DOM/console/network/accessibility),
interaction (click/type/navigate), hot-reload edits, and file transfer. React artifacts build
from a single component (CDN or esbuild-bundled), with React-aware introspection senses
(component tree, props, render-trace).

### Sub-agents (Task)

The `Task` tool dispatches work to isolated sub-agents that run in parallel, each with its own
permission scope. Sub-agents are profiles under `.cortex/agents/*.md` (YAML frontmatter +
instructions; project agents override personal `~/.cortex/agents/`). Set `AGENT_TMUX_MONITOR=true`
for a live tmux pane per agent.

### Auto-research (closed-loop improvement)

A closed-loop experiment runner that measures a change before keeping it: build a **baseline**
and a **candidate**, benchmark both on a graded task set, and gate a keep/discard verdict with
real statistics (Monte-Carlo: bootstrap CI + permutation + N-aware significance, plus a held-out
check). Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch). Driven by
`cortex autoresearch` (`bench` / `experiment` / `evaluate` / `fix` / `list`). Its first
application is the harness improving itself; the loop generalizes to other developmental-
improvement experiments.

### Permission system

Tool execution is gated by a policy engine with three environment profiles in `.cortex/`
(`permissions.dev.json` / `.test.json` / `.prod.json`) and four policy types — whitelist,
blacklist, file-operation, bash-command — with audit logging. `YOLO=true` bypasses all of it.
Manage at runtime via `cortex permissions …`.

### Model router & reactive mentorship

- **Model router** (opt-in, `MODEL_ROUTER_ENABLED`) routes `model="auto"` requests to the best
  model for the task type using recorded benchmark history, with a multi-entry exclude list
  (`MODEL_ROUTER_EXCLUDE`).
- **Reactive mentorship** (opt-in, `MENTORSHIP_ENABLED`) is an AI-to-AI self-improvement loop
  that triggers helper-model review on errors, keywords (`@ultrathink` / `@analyze` / `@rethink`),
  turn intervals, or repeated failure patterns.

## Power-user surfaces

Beyond the core loop, the harness ships surfaces you'd otherwise build yourself:

- **Visual agent monitoring (tmux).** Parallel sub-agents each in a live tmux pane
  (`AGENT_TMUX_MONITOR`), plus an opt-in dashboard (`ENABLE_DASHBOARD=true`) to watch sandbox +
  tmux sessions.
- **Git PR agent.** `PRAgent` runs review/create/list pipelines (and `/v1/pr/*` routes), shelling
  out safely (`execFile`, no shell) behind an opt-in repo/action allow-list and an HMAC-verified
  webhook.
- **Isolated git worktrees.** `WorkspaceManager` hands each agent a clean worktree (clone → branch
  → work → cleanup) so parallel agents never clobber each other.
- **Helper-model middleware.** A cheaper secondary model auto-compacts the conversation near the
  context limit — *compaction first, windowing last*.
- **Session summarization + next-action prediction.** `TURN_SUMMARY_PREDICTION` emits a post-turn
  summary and predicted next action — handy for agent-team handoffs and autonomy loops.
- **Deferred tool loading.** Expose only essential tools up front and let the model discover the
  rest via `SearchTools` — a large first-turn input-token cut on big tool sets.

## Extending

**New tool** — define it in `packages/core/src/tools/`, add it to `BaseToolRegistry`, implement
the executor in `packages/executors/src/implementations/`, register it in `ExecutorRegistry`,
and rebuild.

**New provider** — implement a `FormatAdapter` in `packages/core/src/adapters/`, register it in
`AdapterRegistry`, add model cards under `packages/core/src/models/cards/`, and update the model
registry.

See `packages/*/CLAUDE.md` for per-package reading lists and the exact wiring.
