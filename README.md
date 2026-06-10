# Nexus Cortex

> **A headless, multi-provider AI agent harness — embed it as a library, script it from the CLI, or run it as a stateful agent server.**

[![npm](https://img.shields.io/npm/v/@nexus-cortex/cli)](https://www.npmjs.com/package/@nexus-cortex/cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-green)](https://nodejs.org)

<!-- hero: asciinema/GIF of `cortex "read package.json and bump the patch version"` running a real tool loop -->

Nexus Cortex is the engine *underneath* the agent — not another interactive terminal app, but the harness you build on. One orchestrator drives many models across many providers through a pluggable adapter layer, with sub-agents, MCP, sandboxed artifacts, a permission engine, context management, and append-only session history built in. Run it three ways:

- **As a library** — `import { CortexOrchestrator } from '@nexus-cortex/core'` and drive the full agent loop in-process, zero HTTP overhead.
- **As a headless CLI** — `cortex "…"` for one-shot or multi-turn runs: stateful, scriptable, JSON-out, session-resumable, pipeline-able into agent teams.
- **As a stateful server** — an HTTP agent that holds one persistent session (history + tools + context) behind a REST API for remote/multi-client use.

> **Release 1 is the headless harness** — `@nexus-cortex/core`, `@nexus-cortex/executors`, `@nexus-cortex/server`, and `@nexus-cortex/cli`. The interactive React/Ink terminal UIs (`@nexus-cortex/tui`) land in Release 2.

## Why Nexus Cortex

- **Every major provider, one harness.** The five major labs — **Anthropic, OpenAI, Google/Gemini, xAI, and DeepSeek** — are proven end-to-end. A dozen more (Cloudflare Workers AI, Zhipu/GLM, Qwen, Moonshot/Kimi, MiniMax, Mercury) are wired through the same adapter layer but not yet thoroughly flogged. <!--AUTO-COUNT:models-->84<!--/AUTO-COUNT--> models across <!--AUTO-COUNT:providers-->11<!--/AUTO-COUNT--> providers in all — switch mid-session, route from benchmark history, or mix providers across sub-agents. Run `cortex models list` for the live set.
- **Headless and scriptable by design.** No UI required. Pipe JSON, resume sessions by ID, and chain multi-turn agent workflows — the server is a *stateful agent*, not a stateless endpoint.
- **An embeddable engine, not a closed app.** The orchestrator, adapters, <!--AUTO-COUNT:tools-->45<!--/AUTO-COUNT--> built-in tools, and middleware are a clean TypeScript library you build on — the substrate other agents run on.
- **A real harness, batteries included.** Parallel sub-agents (`Task`) with per-agent permissions, MCP tool integration, a sandboxed-artifact toolset (run + inspect real web apps), git/PR tooling, a policy-based permission engine, token-budget + prompt-cache context management, and append-only JSONL sessions with file checkpoints.
- **A built-in improvement loop (opt-in).** Build a baseline and a candidate, benchmark both on a graded task set, and gate a keep/discard decision with real statistics. It drives the harness's own self-improvement today, and the same loop is designed to generalize to other developmental-improvement tasks (inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch)).

---

## Quick Start

### Install from npm

```bash
# Headless harness — the `cortex` command (chat, autoresearch, scripting) + the HTTP server
npm install -g @nexus-cortex/cli @nexus-cortex/server

# Interactive terminal UIs (@nexus-cortex/tui — neoncortex, launchers): coming in Release 2

# Or embed the library directly
npm install @nexus-cortex/core @nexus-cortex/executors
```

### Run

```bash
# Headless CLI — one-shot or multi-turn (auto-starts a local server)
cortex "What is this project?"

# Or run the stateful HTTP agent directly (port 4000) and talk to it over REST
cortex-server &
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"Hello"}]}'
```

Or embed the orchestrator as a library — see [Core Systems → Cortex Orchestrator](#1-cortex-orchestrator).

### From source

```bash
npm install && npm run build               # multi-pass build (core⇄executors need two passes)
```

### Credentials

Configuration lives in a `.env` file that you create from the tracked template (`.env` itself is gitignored so your keys are never committed):

```bash
cp .env.example .env        # then edit .env and add the provider keys you use
```

Set only the keys for the providers you use — see [API keys & authentication](#api-keys--authentication) for the full list.

**Claude (Anthropic) — API key _or_ OAuth.** Either works; pick one:

- **API key:** set `ANTHROPIC_API_KEY=sk-ant-…` in `.env`.
- **OAuth (Claude.ai Pro/Max subscription)** — two ways to provide the token, resolved in this order:
  1. **`~/.claude/.credentials.json`** *(preferred)* — created automatically when you run `claude login` (Claude Code). If you've already done that, the harness reads it as-is; nothing else to do. It lives in your home directory (not the project), is written owner-only (`chmod 600`), and includes the refresh token so it renews itself. To create it by hand instead:
     ```bash
     mkdir -p ~/.claude && chmod 700 ~/.claude
     cat > ~/.claude/.credentials.json <<'JSON'
     { "claudeAiOauth": {
         "accessToken": "sk-ant-oat01-…",
         "refreshToken": "sk-ant-ort01-…",
         "expiresAt": 1765400000000,
         "scopes": ["user:inference"] } }
     JSON
     chmod 600 ~/.claude/.credentials.json
     ```
  2. **`CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…`** in `.env` (or the environment) — a bare token, handy for headless/CI where there's no `claude login`.

Resolution order is **`~/.claude/.credentials.json` → `CLAUDE_CODE_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`**, and you can pin it with `ANTHROPIC_AUTH_METHOD=auto|oauth|api-key` (default `auto`). The OAuth token is **never** written to any project file — keep it in the home-dir credentials file or `.env`, both outside version control.

See [Headless Mode](#headless-mode) for the full server workflow, or [CLI (headless)](#cli-headless) for the structured command set.

---

## Notable surfaces

Beyond the core agent loop, the harness ships power-user surfaces you'd otherwise have to build yourself. Each is detailed in [Core Systems](#core-systems) below.

- **Visual agent monitoring (tmux).** Run parallel sub-agents each in a live tmux pane (`AGENT_TMUX_MONITOR`), plus a built-in dashboard (port 4001) to watch sandbox + tmux sessions — the `TmuxSession` tool and the `tmux` / `artifact` CLI groups.
- **Git PR agent.** `PRAgent` runs review / create / list pipelines (and the `/v1/pr/*` routes), shelling out safely (`execFile`, no shell) behind an opt-in repo/action allow-list and an HMAC-verified webhook.
- **Isolated git worktrees.** `WorkspaceManager` hands each agent a clean, isolated worktree (clone → branch → work → cleanup) so parallel agents never clobber each other's tree.
- **Helper-model middleware.** A cheaper secondary model auto-compacts the conversation as it nears the context limit — *compaction first, windowing last* — so long sessions keep going without losing the thread.
- **Reactive mentorship middleware.** Opt-in AI-to-AI review: a helper model critiques the driver on tool errors, keywords (`@ultrathink` / `@analyze` / `@rethink`), turn intervals, or repeated failure patterns.
- **Session summarization + next-action prediction.** `TURN_SUMMARY_PREDICTION` emits a post-turn summary and a predicted next action via the helper model — handy for agent-team handoffs and autonomy loops.
- **Sandboxed artifacts + React introspection.** Spin up a runnable web app the model can drive and inspect (screenshot / DOM / console / network / accessibility), with React-aware senses (component tree, props, render-trace).
- **Deferred tool loading.** Expose only essential tools up front and let the model discover the rest via `SearchTools` — ~77% first-turn input-token cut on large tool sets.

---

## Headless Mode

The server is a **stateful agent** — sequential requests share one persistent session with full conversation history, tool execution, and context management. No terminal UI required.

### Start the Server

```bash
# Production (uses DEFAULT_MODEL_ID from .env)
node packages/server/dist/index.js &

# Override model at launch
DEFAULT_MODEL_ID=grok-4-1-fast-reasoning node packages/server/dist/index.js &

# Dev mode (auto-restart on code changes, auto-resumes session)
cd packages/server && npm run dev
```

Port 4000 = API server. Port 4001 = HTML dashboard (sandbox/tmux viewer, same process).

### Cortex CLI

Natural language interface to the running server. No curl required.

```bash
# Simple query
cortex "What is this project?"

# Use a specific model
cortex --model deepseek-chat "Explain TypeScript generics"

# Multi-turn conversation (session persists automatically)
cortex "Remember the launch code is FALCON-42"
cortex "What was the launch code?"

# JSON output for scripting and agent workflows
cortex --json "List the npm scripts" | jq '.content[0].text'

# Session management
cortex --sessions                          # List all sessions
cortex --stats                             # Current session stats
cortex --new "Start a fresh conversation"  # New session
cortex --resume SESSION_ID "Continue here" # Resume specific session
cortex --quiet "Just the answer"           # Response only, no metadata
```

Install globally: `npm install -g @nexus-cortex/cli` (or `npm run link` from source) — makes `cortex` available everywhere.

### Agent Team Usage

The session ID enables multi-turn agent workflows:

```bash
SESSION=$(cortex --quiet --json "Analyze test gaps" | jq -r '.sessionId')
cortex --resume $SESSION "Now fix the top priority gap"
cortex --resume $SESSION "Run the tests to verify"
```

### curl (Direct HTTP)

```bash
# Send a message
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"Read package.json and tell me the version"}]}'

# Multi-turn: next request continues the same conversation
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"What dependencies does it have?"}]}'
```

### Response Fields

| Field | Description |
|-------|-------------|
| `content[]` | Model text response |
| `toolUses[]` | Tools called (name, input, result) |
| `usage.inputTokens` | Total input tokens (reveals system message overhead) |
| `usage.outputTokens` | Response size |
| `usage.cache` | Cache hit rate and cost savings |
| `metadata.toolCallIterations` | Tool round-trips |

### Session Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sessions` | GET | List all sessions |
| `/sessions/new` | POST | Start fresh session (old one saved) |
| `/sessions/:id/stats` | GET | Token usage, turns, tool calls |
| `/sessions/:id/messages` | GET | Full message history |
| `/sessions/:id/model` | POST | Switch model mid-session |
| `/sessions/:id/compaction` | POST | Trigger context compaction |
| `/sessions/:id/cache/metrics` | GET | Cache hit rate and savings |
| `/health` | GET | Server status and available models |

Additional REST surfaces (run the server and `curl` them): `/tools`, `/permissions/*`,
`/middleware/*`, `/config/*`, `/mcp/*`, `/system-messages/*`, and `/v1/approval-mode`.
Session routes also include `export`, `DELETE`, `checkpoints`, `load`, `resume`,
`context`, and `compaction/boundaries`.

### PR Review API

When the git/PR tools are configured (see [Git / PR access control](#git--pr-access-control)):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/pr/review` | POST | Run a PR review pipeline (`{repo, prNumber, options?}`) |
| `/v1/pr/create` | POST | Drive PR creation in an isolated worktree (`{repo, branch?, description?}`) |
| `/v1/pr/list` | GET | List open PRs (`?repo=owner/repo`) |
| `/v1/pr/webhook` | POST | GitHub webhook — requires `GITHUB_WEBHOOK_SECRET` + a valid `X-Hub-Signature-256` (disabled, returns 401, if no secret is set) |

### Server Lifecycle

The server does **not** auto-shutdown after responses. It runs until explicitly stopped:

```bash
# Stop the server
pkill -f "packages/server/dist/index.js"   # or Ctrl+C if foreground
```

**Session resume**: By default the server starts a **fresh** session on boot. Opt into resuming with environment variables:

| Variable | Default | Behavior |
|----------|---------|----------|
| `AUTO_RESUME` | `false` | `true` → resume the most recent session on startup |
| `RESUME_SESSION_ID` | — | Resume a specific session by UUID (overrides `AUTO_RESUME`) |

With `AUTO_RESUME=true`, `tsx watch` restarts (dev mode) seamlessly continue your conversation — code changes take effect without losing session state. Pair `AUTO_RESUME=true` with `SERVER_IDLE_TIMEOUT` (below) for a "sleep when idle, resume on wake" daemon.

### Common launch variables

The variables you'll reach for most when starting the server:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_MODEL_ID` | `deepseek-v4-pro` | Model to use (any registry ID or alias) |
| `PORT` | `4000` | Server port (falls back to the next free port if taken) |
| `DEBUG` | `false` | Verbose logging (system messages, routes) |
| `YOLO` | `false` | Auto-approve all tool executions (bypasses permissions) |
| `CORTEX_MODE` | `persistent` | `stateless` for clean per-request sessions; `server` for HTTP-client mode |

**Every** variable is documented in [Configuration → Environment Variables](#environment-variables) below and in `.env.example`. Run `node packages/server/dist/index.js --help` for the server's own summary.

---

## Architecture

### Monorepo Structure

```
nexus-cortex/
├── packages/
│   ├── types/              # Shared TypeScript types
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
│   ├── server/             # Express HTTP server (optional)
│   │   └── routes/         # REST API endpoints
│   └── cli/                # Interactive CLI interface
│       ├── commands/       # CLI command handlers
│       ├── themes/         # Built-in color themes
│       └── ui/             # Terminal UI components
├── .cortex/                # Auto-generated project context
│   ├── CORTEX.md           # Project context (auto-loaded)
│   └── system-messages/    # Custom system messages
└── scripts/                # Build and maintenance scripts
```

### Direct-Wired vs Server Mode

**Direct Mode (Default)**:
- Core library imported directly into CLI process
- Zero network overhead (~1ms vs ~15ms per operation)
- Immediate access to all orchestrator features
- Single-process debugging
- Recommended for development

**Server Mode (Optional)**:
- HTTP server for web/mobile clients
- REST API endpoints for remote access
- Multi-client support
- Enable with `--server` flag

```bash
# Direct mode (default)
cortex

# Server mode (local)
cortex --server

# Server mode (remote)
cortex --server http://remote:4000
```

---

## Core Systems

### 1. Cortex Orchestrator

The orchestrator coordinates all AI interactions, tool execution, and session management:

```typescript
import { CortexOrchestrator } from '@nexus-cortex/core';

const orchestrator = new CortexOrchestrator({
  modelId: 'claude-sonnet-4-5',
  projectPath: process.cwd(),
  mcpAutoInject: true,
  debug: false
});

const response = await orchestrator.processMessage({
  role: 'user',
  content: 'Analyze this codebase'
});
```

### 2. Multi-Provider System

**<!--AUTO-COUNT:models-->84<!--/AUTO-COUNT--> models across <!--AUTO-COUNT:providers-->11<!--/AUTO-COUNT--> providers**, reached through a pluggable adapter
layer (Messages, Chat Completions, GenerateContent, GenAI, Responses). Each provider is
enabled by its API key — set only the ones you use.

**Maturity:** the **five major labs are proven end-to-end** (driven hard through the full
tool loop, sub-agents, caching, and the benchmark harness). The smaller labs are
**incorporated through the same adapters but not yet thoroughly tested** — they should
work; treat them as preview. **Run `cortex models list` for the live, exact set;** the
examples below are illustrative. (Counts auto-update from the registry — see
`scripts/update-doc-counts.mjs`.)

| Provider | Status | Example models | API key |
|----------|--------|----------------|---------|
| Anthropic | **Proven** | `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| OpenAI | **Proven** | `gpt-5.x`, `gpt-5-codex`, `gpt-4.1`, `gpt-4o`, `o3` / `o4` | `OPENAI_API_KEY` |
| Google (Gemini + Gemma) | **Proven** | `gemini-2.5-pro`, `gemini-3.5-flash`, `gemma-3-27b-it` | `GEMINI_API_KEY` / `GOOGLE_API_KEY` |
| xAI | **Proven** | `grok-4.3`, `grok-4-fast`, `grok-build-0.1` | `XAI_API_KEY` |
| DeepSeek | **Proven** | `deepseek-v4-pro`, `deepseek-reasoner`, `deepseek-chat` | `DEEPSEEK_API_KEY` |
| Cloudflare Workers AI | Preview | `@cf/*` models | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |
| Zhipu / GLM | Preview | `glm-4.6`, `glm-4.5`, `glm-4-flash` | `ZHIPU_API_KEY` |
| Qwen (DashScope) | Preview | `qwen-*` | `DASHSCOPE_API_KEY` |
| Moonshot (Kimi) | Preview | `moonshot-*` / `kimi-*` | `MOONSHOT_API_KEY` |
| MiniMax | Preview | `minimax-*` | `MINIMAX_API_KEY` |
| Mercury (Inception) | Preview | `mercury-2` | `INCEPTION_API_KEY` |

### 3. Tool System

**<!--AUTO-COUNT:tools-->45<!--/AUTO-COUNT--> built-in tools** with read-before-edit safety and a dual registry (immutable
base tools + dynamic addon tools), plus any tools discovered from connected MCP servers.
The groups below are illustrative — **run `cortex tools list` (or `/tools list`) for the
live, authoritative set with descriptions.** By category:

- **File & notebook** — `Read`, `Write`, `WriteBinary`, `Edit`, `NotebookEdit`
- **Search** — `Glob`, `Grep`
- **Shell** — `Bash`, `BashOutput`, `KillShell` (foreground + background processes)
- **Web & browser** — `WebFetch`, `WebSearch`, `Browse` (headless Chrome)
- **Sub-agents** — `Task` (parallel agent dispatch)
- **Git & PR** — `PRAgent` (review/create/list), `WorkspaceManager` (isolated git worktrees)
- **Sandboxed artifacts** — `CreateArtifactTool`, `InspectSandbox`, `InteractWithSandbox`, `ModifySandbox`, `StopSandbox`, `SandboxTransfer`
- **React introspection senses** — `SandboxScan`, `SandboxGrab`, `SandboxDetectFramework`, `SandboxComponentTree`, `SandboxRenderTrace`
- **Conversation history** — `SearchConversationHistory`, `GetConversationSegment`, `RequestHistoricalContext`, `ListCompactionBoundaries`, `ListSessions`, `LoadSession`
- **MCP & tool discovery** — `SearchTools` (deferred/progressive tool loading) + dynamically-registered MCP tools
- **Planning & UI** — `TodoCreate`, `TodoUpdate`, `TodoList`, `AskUserQuestion`, `ExitPlanMode`
- **Code & monitoring** — `CodeExecute`, `TmuxSession` (visual agent monitoring)
- **Auto-research** — `ResearchBacklog`
- **Skills & commands** — `Skill`, `SlashCommand`
- **End-of-turn audit** — `EndTurn` (opt-in via `CORTEX_ENDTURN_GATE`)

### 4. System Message Management

Auto-loading system messages from multiple sources:

```
.cortex/
├── CORTEX.md                    # Auto-generated project context
└── system-messages/
    ├── 01-custom-instructions.md
    ├── 02-coding-standards.md
    └── 03-project-guidelines.md
```

**CORTEX.md Auto-Generation**:
```bash
# Generate project context in CLI
/init

# Or programmatically
import { InitCortexContext } from '@nexus-cortex/core';

await InitCortexContext.execute({
  scope: 'auto',      // or 'global' for ~/.cortex/
  max_depth: 5        // auto-detects monorepos
}, process.cwd());
```

CORTEX.md includes:
- Project description (from README.md)
- File tree structure (depth 5 for monorepos, 4 for regular projects)
- Dependency analysis (npm, Python, Rust, Go)
- Available scripts (package.json, Makefile)
- Monorepo package structure with descriptions

### 5. MCP Integration

Full Model Context Protocol support:

```bash
# CLI slash commands
/mcp list              # List configured MCP servers
/mcp enable <name>     # Enable an MCP server
/mcp disable <name>    # Disable an MCP server
```

Configuration in `.cortex/mcp_config.json`:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"]
    }
  }
}
```

### 6. Session Management

JSONL-based conversation persistence with full state recovery:

- **Format**: Append-only JSONL (one JSON object per line) in `.cortex/sessions/`
- **IDs**: UUID-based message tracking (zero collision risk)
- **Checkpoints**: Content-addressable file history in `.cortex/file-history/`
- **Compaction**: Helper model auto-compacts at configurable token threshold
- **Auto-resume**: Server resumes most recent session on startup (see [Headless Mode](#server-lifecycle))
- **REST API**: session endpoints for listing, stats, model switching, and compaction (see [Session Management API](#session-management-api))

### 7. Sandboxed Artifacts & Visual Workspace

`CreateArtifactTool` spins up a runnable web/server app in a tmux-managed sandbox, and the
model iterates against it with real feedback:

- **Snapshots** the model can inspect: screenshot, DOM, console, network, accessibility tree (`InspectSandbox`).
- **Interaction**: click/type/navigate (`InteractWithSandbox`), hot-reload edits (`ModifySandbox`), file transfer (`SandboxTransfer`), teardown (`StopSandbox`).
- **React artifacts**: `framework: "react"` builds a React app from a single component — zero-install CDN mode or an esbuild-bundled mode with source maps and rebuild-on-edit.
- **React introspection senses**: `SandboxScan` (elements + stable `cssSelector` + `componentName`), `SandboxGrab` (DOM + React props/source location), `SandboxComponentTree` (fiber hierarchy), `SandboxRenderTrace` (per-component re-render counts/timings).

### 8. Sub-Agents (Task)

The `Task` tool dispatches work to isolated sub-agents that run in parallel, each with its
own permission scope. Sub-agents are defined as profiles under `.cortex/agents/*.md` (YAML
frontmatter + instructions; project agents override personal `~/.cortex/agents/`). Set
`AGENT_TMUX_MONITOR=true` for a live tmux pane per agent.

### 9. Auto-Research (closed-loop improvement)

A closed-loop experiment runner that measures a change before keeping it: build a
**baseline** and a **candidate**, benchmark both on a graded task set, and gate a
keep/discard verdict with real statistics (Monte-Carlo: bootstrap CI + permutation +
N-aware significance, plus a held-out check). Inspired by
[karpathy/autoresearch](https://github.com/karpathy/autoresearch).

Its first application is the harness improving **itself**, but the loop
(build → benchmark → gate) is designed to generalize to other developmental-improvement
experiments. Driven by `cortex autoresearch`:

- **`bench`** — run + grade a task set through a build, writing scored records to `.cortex/router-matrix.jsonl`.
- **`experiment`** — build + serve a base and a candidate, bench both (train + hold-out), then gate a keep/discard verdict with a JSONL artifact.
- **`evaluate` / `fix` / `list`** — score an experiment, apply a fix from the deficiency backlog, and review recorded keep/discard decisions.

### 10. Permission System

Tool execution is gated by a policy engine with three environment profiles in `.cortex/`
(`permissions.dev.json` / `.test.json` / `.prod.json`) and four policy types — whitelist,
blacklist, file-operation, and bash-command — with audit logging. `YOLO=true` bypasses all
of it (use with care). Manage at runtime via `cortex permissions …` or `/permissions`.

### 11. Model Router & Reactive Mentorship

- **Model router** (opt-in, `MODEL_ROUTER_ENABLED`): routes `model="auto"` requests to the best model for the task type using recorded benchmark history, with a multi-entry exclude list (`MODEL_ROUTER_EXCLUDE`).
- **Reactive mentorship** (opt-in, `MENTORSHIP_ENABLED`): an AI-to-AI self-improvement loop that triggers helper-model review on errors, keywords (`@ultrathink`/`@analyze`/`@rethink`), turn intervals, or repeated failure patterns. See the [mentorship env vars](#environment-variables).

---

## CLI (headless)

`cortex` is a headless command — one-shot or multi-turn natural-language queries, plus a
full structured command set. Run `cortex --help`, or `cortex <group> --help` for any group:

| Group | What it does |
|-------|--------------|
| `cortex "<prompt>"` | One-shot query (`-m/--model`, `--system`, `--max-tokens`, `--json`) |
| `models` | `list` / `info` / `search` / `compare` / `cost` / `providers` / `switch` |
| `sessions` | `list` / `view` / `export` / `resume` / `checkpoints` / `stats` / `search` / `compact` |
| `config` | `get` / `set` / `categories` / `category` / `reset` |
| `mcp` | `list` / `status` / `tools` / `enable` / `disable` / `init` / `validate` / `edit` |
| `permissions` | `mode` / `set` / `grant` / `revoke` / `policies` / `tools` / `auto-approve` |
| `autoresearch` | `bench` / `experiment` / `evaluate` / `fix` / `list` (see [Auto-Research](#9-auto-research-closed-loop-improvement)) |
| `context` | `status` / `compact` / `boundaries` / `strategy` / `savings` |
| `middleware` | `list` / `status` / `enable` / `disable` / `config` |
| `artifact` | `list` / `status` / `restart` / `stop` |
| `tmux` | `list` |
| `tools` | `list` / `info` |
| `cache` | `metrics` |
| `system-messages` | `list` / `view` / `reload` |
| `server` | `status` / `start` |

> **Interactive terminal UIs — Release 2.** A React/Ink chat UI (`neoncortex`), a Chalk
> UI (`fuzzycortex`), the slash-command set, and a built-in color-theme system ship in
> `@nexus-cortex/tui` in the next release. Release 1 is headless-only.

---

## Development

### Build Commands

```bash
# Clean build artifacts
npm run clean

# Build all packages (types → executors → core → server → cli)
npm run build

# Type checking
npm run typecheck

# Run tests
npm test

# Run tests with coverage
npm run test:ci

# Lint code
npm run lint

# Format code
npm run format
```

### Dev Workflow (Stateful Iteration)

The recommended development loop uses the server in dev mode with auto-resume:

```bash
# Terminal 1: Start server with hot reload
cd packages/server && npm run dev

# Terminal 2: Send messages (each builds on the last)
cortex "Read the orchestrator and explain the tool loop"
cortex "Now add logging before each tool call"
cortex "Run the tests to verify"
```

**What survives restarts:**
- **System message edits** (CORTEX.md, MEMORY.md, custom system messages) — read fresh each turn, no restart needed
- **Code changes** — tsx watch restarts the server, auto-resumes session from JSONL
- **Session state** — full message history, cache metrics, turn count restored from disk

```bash
# Fresh start (skip auto-resume)
AUTO_RESUME=false npm run dev

# Resume specific session
RESUME_SESSION_ID=409808cb-6083-4be3-b537-856a0d755032 npm run dev

# Kill server
pkill -f "packages/server/dist/index.js"
```

### Package Build Order

The monorepo uses a strict build order due to dependencies:

1. **@nexus-cortex/types** - Shared TypeScript types
2. **@nexus-cortex/executors** - Tool executors (depends on core, partial build first)
3. **@nexus-cortex/core** - Core library (depends on types)
4. **@nexus-cortex/executors** - Complete build (depends on core)
5. **@nexus-cortex/server** - HTTP server (depends on core)
6. **@nexus-cortex/cli** - Headless CLI: `cortex` (chat, autoresearch, scripting; depends on core)
7. **@nexus-cortex/tui** - Interactive React/Ink + chalk terminal UIs (Release 2 — not yet published)

### Adding New Features

**New Tool**:
```typescript
// packages/core/src/tools/MyTool.ts
export class MyTool {
  static async execute(input: MyToolInput): Promise<MyToolOutput> {
    // Implementation
  }

  static getToolDefinition(): CanonicalTool {
    return {
      name: 'MyTool',
      description: 'Description',
      schema: { /* JSON schema */ }
    };
  }
}
```

**New Provider**:
```typescript
// packages/core/src/providers/MyProvider.ts
export class MyProvider extends BaseProvider {
  async sendMessage(config: ProviderConfig): Promise<ProviderResponse> {
    // Implementation
  }
}
```

**New Slash Command**:
```typescript
// packages/cli/src/commands/slash/SlashCommandRegistry.ts
this.register({
  name: 'mycommand',
  category: 'system',
  description: 'My command description',
  usage: '/mycommand [args]'
});

// packages/cli/src/commands/chat/interactive.ts
case 'mycommand':
  // Handle command
  break;
```

---

## Configuration

### Environment Variables

All settings are environment variables in `.env` at the repo root (copy `.env.example` to start). Only API keys are required; every other variable has a proven-optimal default.

**The full annotated reference is [`docs/configuration.md`](./docs/configuration.md)** — every variable with its default and usage, grouped by category — mirroring the canonical [`.env.example`](./.env.example) template and the `packages/core/src/config/SettingsSchema.ts` schema. The variables you'll reach for most are in [Headless Mode → Common launch variables](#common-launch-variables) above; the interactive `/config` command edits them for you.

### Editing settings

The behavioral configuration above is all environment variables, read from `.env` (or the process environment). Two ways to change them:

- **Edit `.env`** directly (copy from `.env.example`), or set the variable inline at launch.
- **`/config`** in the CLI — an interactive editor that reads/writes `.env` against the schema in `packages/core/src/config/SettingsSchema.ts` (with validation and defaults). `cortex config reset` restores the proven-optimal defaults while preserving your API keys.

### UI preferences file (`.cortex/config.json`)

Separately, the interactive terminal UIs persist your **theme** and **default model** to `.cortex/config.json` (in the project's `.cortex/` directory). You don't edit this by hand — it's written automatically when you pick a theme or model in the UI (`/theme`, the model picker). It supports a legacy flat shape and per-launcher overrides (`neoncortex`, `fuzzycortex`, `cortexserver`):

```json
{
  "theme": "monokai",
  "defaultModel": "claude-sonnet-4-6",
  "neoncortex":  { "theme": "dracula", "defaultModel": "grok-4.3" },
  "fuzzycortex": { "theme": "monokai" }
}
```

Each interactive launcher keeps its own theme/model — `neoncortex` (Ink UI), `fuzzycortex` (Chalk UI), `cortexserver` — and a per-launcher entry overrides the flat values for that launcher. **Only** UI preferences are stored here: behavioral settings (permissions, MCP auto-inject, debug, etc.) are `.env` variables, and secrets/tokens (e.g. `CLAUDE_CODE_OAUTH_TOKEN`) are **never** written to this tracked file — a save-time guard strips any secret-looking key.

Project-scoped resources (agents, slash commands, permissions, MCP servers, system messages) also live under `.cortex/` — see those sections below.

### MCP Configuration

`.cortex/mcp_config.json`:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## Production Deployment

### Server Mode

```bash
# Production server
NODE_ENV=production PORT=4000 node packages/server/dist/index.js

# With PM2
pm2 start packages/server/dist/index.js --name nexus-cortex
```

### Global CLI Installation

From npm:

```bash
npm install -g @nexus-cortex/cli
```

From source — `npm run build` auto-links the global commands:

```bash
npm install && npm run build     # builds + links
npm run link                     # re-link any time (self-healing)

# Then use from anywhere:
cortex "your prompt"             # headless (chat, autoresearch, scripting)
# Interactive UIs (neoncortex, fuzzycortex-cli) ship in Release 2
```

---

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
npm run clean
npm run build
```

### TypeScript Errors

```bash
# Check types
npm run typecheck

# Strict null checks issue
# Ensure all array accesses check for undefined
```

### MCP Server Issues

```bash
# Test MCP server manually
npx -y @modelcontextprotocol/server-filesystem /path/to/dir

# Check MCP config
cat .cortex/mcp_config.json

# Enable debug logs
/debug
```

### Missing API Keys

Ensure all required API keys are set:
```bash
echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY
```

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Make changes with tests
4. Run preflight checks (`npm run typecheck && npm test`)
5. Commit changes (`git commit -m 'Add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Open Pull Request

---

## License

Apache-2.0 — see [LICENSE](LICENSE). Copyright 2026 Spitfire-Products.

---

## Links

- [Configuration reference](./docs/configuration.md) — every environment variable, annotated
- [Changelog](./CHANGELOG.md) — release history
- [License](./LICENSE) — Apache-2.0 ([NOTICE](./NOTICE))
- [Issues & source](https://github.com/Spitfire-Products/nexus-cortex) — report bugs, request features

Built clean-room as a multi-provider TypeScript agent harness by Spitfire-Products.

> `CORTEX.md` (project context) is generated on demand in your own project — run `/init` or the `InitCortexContext` tool; it is not shipped with the package.

