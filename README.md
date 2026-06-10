# Nexus Cortex

**Multi-provider AI agent harness — a direct library, an optional HTTP server, and terminal UIs.**

Version: 4.9.0 · License: Apache-2.0

---

## Overview

Nexus Cortex is a production-ready AI development CLI that provides direct access to multiple LLM providers (Anthropic, OpenAI, Google, XAI, DeepSeek, and more) through an elegant command-line interface. Built as a TypeScript monorepo, it features a unique direct-wired architecture that eliminates HTTP overhead while maintaining optional server mode for web/mobile clients.

### Key Features

- **Direct-Wired Architecture** - Core library runs in-process for zero-latency tool execution
- **Multi-Provider Support** - 10+ AI providers with 65+ model configurations
- **Interactive CLI** - Rich terminal UI with slash commands, themes, and real-time feedback
- **MCP Integration** - Full Model Context Protocol support for extended tool capabilities
- **System Message Management** - Auto-loading project context via CORTEX.md and custom system messages
- **Session Persistence** - JSONL-based conversation history with UUID tracking
- **Tool Suite** - 17+ standard tools with context-aware execution
- **Optional HTTP Server** - Run as REST API for remote/web clients

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
# neoncortex (interactive React/Ink UI)     # Release 2
cortex "What is this project?"              # headless natural-language query (auto-starts a server)
cortex-server &                             # or run the HTTP server directly (port 4000)

# Headless server + curl
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"Hello"}]}'
```

### From source

```bash
npm install && npm run build               # 7-pass build of all 6 packages
```

See [Headless Mode](#headless-mode) for the full server workflow, or [CLI Interface](#cli-interface) for the interactive terminal UI.

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
│   │   ├── orchestrator/   # CortexOrchestrator (main engine)
│   │   ├── providers/      # 10+ AI provider adapters
│   │   ├── models/         # Model registry (65+ models)
│   │   ├── tools/          # Tool definitions & executors
│   │   ├── mcp/            # MCP client & server integration
│   │   ├── system-messages/# System message auto-loading
│   │   └── session/        # JSONL session storage
│   ├── server/             # Express HTTP server (optional)
│   │   └── routes/         # REST API endpoints
│   └── cli/                # Interactive CLI interface
│       ├── commands/       # CLI command handlers
│       ├── themes/         # 15 professional themes
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

10 AI providers with 65+ model configurations:

- **Anthropic** - Claude 3.5 Sonnet, Claude 3 Opus, Haiku
- **OpenAI** - GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
- **Google** - Gemini 2.0 Flash, Gemini 1.5 Pro
- **XAI** - Grok 2, Grok Vision
- **DeepSeek** - DeepSeek V3, DeepSeek Chat
- **GLM** - GLM-4, GLM-4 Vision
- **Qwen** - Qwen 2.5, Qwen Turbo
- **Moonshot** - Moonshot V1
- **MiniMax** - MiniMax models
- **Gemma** - Google Gemma models

### 3. Tool System

A rich tool suite with read-before-edit safety and context-aware execution:

**File Operations**: Read, Write, Edit, Glob, Grep
**System**: Bash, TodoWrite, AskUserQuestion
**MCP**: ListMcpResources, Mcp, ReadMcpResource, InitMcpConfig, ListMcpServers
**Context**: InitCortexContext
**Session**: Skill, SlashCommand

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
- **REST API**: 7 session endpoints for listing, stats, model switching, and compaction (see [Session Management API](#session-management-api))

---

## CLI Interface

### Interactive Mode

```bash
$ cortex

╔══════════════════════════════════════════════════════════╗
║             Nexus Cortex - AI Development CLI           ║
╚══════════════════════════════════════════════════════════╝

Model: claude-sonnet-4-5 | Session: abc-123 | Theme: monokai

> You: /help

Available Commands:
  /models list          - Show all available models
  /models switch        - Switch to different model
  /session checkpoint   - Save conversation checkpoint
  /cache metrics        - View cache statistics
  /system-message       - Manage system messages
  /init                 - Generate CORTEX.md context
  /debug                - Toggle debug logs
  /yolo                 - Enable auto-approve mode
  /clear                - Clear conversation
  /exit                 - Exit CLI

> You: Analyze the file structure```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/models list` | List all available models |
| `/models switch <id>` | Switch to a different model |
| `/models info <id>` | Show model details |
| `/session checkpoint [name]` | Create session checkpoint |
| `/session list` | List all sessions |
| `/continue` | Load and continue previous session |
| `/cache metrics` | View cache statistics |
| `/mcp list` | List MCP servers |
| `/mcp enable <name>` | Enable MCP server |
| `/tools list` | List available tools |
| `/system-message` | Interactive system message manager |
| `/init` | Generate CORTEX.md context |
| `/debug` | Toggle debug log visibility |
| `/yolo` | Enable auto-approve all tools |
| `/clear` | Clear conversation history |
| `/exit` | Exit CLI |

### Theme System

15 professional themes available:

```bash
# Configure theme in .cortex/settings.json
{
  "theme": "monokai"  // or tokyo-night, dracula, solarized-dark, etc.
}
```

Available themes:
- `default`, `dracula`, `monokai`, `nord`, `solarized-dark`, `solarized-light`
- `tokyo-night`, `gruvbox`, `one-dark`, `material`, `palenight`
- `ayu-dark`, `catppuccin`, `synthwave`, `cyberpunk`

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

All settings live in `.env` at the repo root (copy `.env.example` to start). Only API keys are required; every other variable has a proven-optimal default. The full reference below is grouped the same way as `.env.example`. The canonical schema is `packages/core/src/config/SettingsSchema.ts`; the interactive `/config` command (CLI) edits these for you.

> **How loading works:** values are read from `.env` (or the real environment) at startup. Per-launch overrides win — e.g. `DEFAULT_MODEL_ID=grok-4.3 PORT=4100 node packages/server/dist/index.js`. Booleans are the literal strings `true`/`false`.

#### API keys & authentication

Set the keys for the providers you use; leave the rest blank. A model is only available if its provider key is present.

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `ANTHROPIC_API_KEY` | — | Claude (Fable/Opus/Sonnet/Haiku) models. |
| `OPENAI_API_KEY` | — | GPT / o-series models. |
| `GOOGLE_API_KEY` | — | Gemini models (legacy key; `GEMINI_API_KEY` takes priority). |
| `GEMINI_API_KEY` | — | Preferred Gemini key; falls back to `GOOGLE_API_KEY`. |
| `XAI_API_KEY` | — | xAI Grok models. |
| `DEEPSEEK_API_KEY` | — | DeepSeek models (the default model's provider). |
| `NVIDIA_API_KEY` | — | NVIDIA-hosted models. |
| `INCEPTION_API_KEY` | — | Inception Labs Mercury diffusion models (`mercury-2`). |
| `CLOUDFLARE_API_TOKEN` | — | Cloudflare Workers AI (`@cf/*` models). Requires `CLOUDFLARE_ACCOUNT_ID`. |
| `CLOUDFLARE_ACCOUNT_ID` | — | Cloudflare account ID (paired with the token above). |
| `DASHSCOPE_API_KEY` | — | Alibaba Qwen (DashScope) — `qwen-*` models. |
| `MINIMAX_API_KEY` | — | MiniMax — `minimax-*` models. |
| `MOONSHOT_API_KEY` | — | Moonshot AI (Kimi) — `moonshot-*` / `kimi-*` models. |
| `ZHIPU_API_KEY` | — | Zhipu AI (GLM) — `glm-*` models. |
| `HUGGINGFACE_API_KEY` | — | Hugging Face Inference (`HUGGINGFACE_TOKEN` also accepted). |
| `ANTHROPIC_AUTH_METHOD` | `auto` | `auto` (oauth→key) \| `oauth` \| `api-key`. `.env.example` ships `api-key`; use `oauth` with a Claude.ai Max subscription. |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | OAuth token override (alternative to `~/.claude/.credentials.json`). |

#### Model selection

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `DEFAULT_MODEL_ID` | `deepseek-v4-pro` | Primary model — any registry ID or alias (`cortex models list`). |
| `HELPER_MODEL_ID` | `deepseek-v4-flash` | Cheaper model for compaction & mentorship. |
| `WEB_TOOLS_MODEL` | `gemini-2.5-flash` | Model backing `WebSearch`/`WebFetch`; provider auto-detected from the ID prefix. |

#### System

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `DEBUG` | `false` | Verbose logging (system-message assembly, routes). Toggle at runtime via `/debug`. |
| `USE_EMOJI` | `false` | Allow emoji in CLI output. |
| `PROJECT_PATH` | cwd | Project root the tools operate on. |
| `PROJECT_ROOT` | `PROJECT_PATH`/cwd | Explicit override of the project root (set by the server at startup). |

#### Reactive mentorship (AI-to-AI self-improvement)

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `MENTORSHIP_ENABLED` | `false` | Master switch for the mentorship system. |
| `MENTORSHIP_TRIGGER_ON_ERROR` | `true` | Trigger helper-model review on tool errors (only applies when mentorship is enabled). |
| `MENTORSHIP_ERROR_THRESHOLD` | `medium` | Minimum severity to trigger: `low` \| `medium` \| `high`. |
| `MENTORSHIP_KEYWORDS_ENABLED` | `false` | React to `@ultrathink` / `@analyze` / `@rethink`. |
| `MENTORSHIP_CUSTOM_KEYWORDS` | — | Comma-separated extra trigger keywords. |
| `MENTORSHIP_HELPER_MODEL` | `deepseek-v4-flash` | Model used for mentorship, overriding `HELPER_MODEL_ID` (`.env.example` ships a Cloudflare Gemma override). |
| `MENTORSHIP_TURN_BASED_ENABLED` | `false` | Periodic review every N turns. |
| `MENTORSHIP_TURN_INTERVAL` | `10` | Turns between periodic reviews (1–50). |
| `MENTORSHIP_INTERLEAVED_THINKING` | `false` | Inject thinking for non-reasoning models. |
| `MENTORSHIP_PATTERN_DETECTION` | `false` | Detect repeated failure patterns. |
| `MENTORSHIP_PATTERN_THRESHOLD` | `3` | Similar errors needed to flag a pattern (2–10). |
| `MENTORSHIP_ACTIVE_DISCOVERY` | `false` | Proactive mentorship discovery (runtime flag). |
| `TURN_SUMMARY_PREDICTION` | `false` | Post-turn summary + next-action prediction via the helper model. |

#### Context management

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `ANTHROPIC_PROMPT_CACHING` | `true` | Enable Anthropic prompt caching (up to ~90% input-token savings). |
| `CONTEXT_BUDGET_STRATEGY` | `priority-based` | `priority-based` (keeps tool pairs) or `sliding-window` (dumb recency). |

#### Session

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `SESSION_STORAGE_DIR` | `.cortex/sessions` | Where JSONL session files are written. |
| `MCP_AUTO_INJECT` | `false` | Auto-inject connected MCP servers' tools into every turn. |
| `SYSTEM_MESSAGE_DOC_MAX_BYTES` | `0` | Per-doc byte cap for injected project docs (CORTEX.md, MEMORY.md). `0` = unlimited. |

#### Loop control

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `MAX_TOOL_ITERATIONS` | `50` | Max tool executions per turn. |
| `MAX_CONSECUTIVE_ERRORS` | `3` | Stop the turn after this many consecutive all-error iterations. |
| `TOOL_BUDGET_SOFT` | `15` | Soft per-turn tool-call budget (decisiveness brake). |
| `TOOL_TIMEOUT_MS` | `120000` | Per-tool execution timeout (ms). |
| `MAX_LOOP_REPETITIONS` | `5` | Identical tool calls before loop detection breaks the turn. |

#### Provider tooling

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `ENABLE_SERVER_SIDE_TOOLS` | `true` | xAI/OpenAI hosted server-side tools (hybrid is ~20–26% faster). |
| `XAI_API_MODE` | `messages` | xAI request surface: `messages` (CC-style) or `responses` (server-side tools). |
| `OPENAI_API_MODE` | `chat/completions` | OpenAI request surface: `chat/completions` or `responses` (opt into hosted server-side tools). |
| `ENABLE_DEFERRED_TOOL_LOADING` | `true` | Load only essential tools up front; discover the rest via `SearchTools` (~77% first-turn input-token cut). |
| `ENABLE_PTC` | `false` | Programmatic tool calling (compose tool calls in a script). |
| `ENABLE_LOCAL_CODE_EXECUTION` | `false` | Allow local code-execution tooling. |

#### Model router (auto model selection)

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `MODEL_ROUTER_ENABLED` | `false` | Auto-route `model="auto"` requests from benchmark history. |
| `MODEL_ROUTER_STRATEGY` | `auto` | `auto` (classify the prompt) or `matrix-only` (require an explicit task type). |
| `MODEL_ROUTER_RECORD` | `true` | Record turn metrics to `.cortex/router-matrix.jsonl` (independent of routing being on). |
| `MODEL_ROUTER_EXCLUDE` | `grok*` | Comma list of model IDs the router must never pick; trailing `*` = prefix wildcard. |
| `MODEL_ROUTER_EXPLORATION` | `false` | Posterior-sampling explore/exploit instead of a greedy pick. |
| `ROUTER_MIN_CONFIDENCE` | `0.3` | Min task-classification confidence (0–1) before `auto` routes; below it, inherit the parent model. |
| `ROUTER_MIN_SAMPLES` | `3` | Min benchmark samples a task type needs before `auto` trusts its recommendation. |

#### End-of-turn audit / training substrate (opt-in)

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `CORTEX_ENDTURN_GATE` | `false` | `true` = mandatory `EndTurn` self-audit + graded training records. Off = the tool is hidden. |

#### Decision store (prior recall)

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `CORTEX_RECORD_DECISIONS` | `true` | Append each tool decision to `.cortex/decisions.jsonl`. |
| `CORTEX_LOOKUP_PRIOR_DECISIONS` | `true` | Inject prior decisions as a `<system-reminder>` before tool use. |
| `CORTEX_DECISIONS_MAX_BYTES` | `2097152` | Rotation cap (bytes) for `decisions.jsonl` (default 2 MB). |
| `CORTEX_GIT_CONTEXT` | `true` | Per-turn "Repository State" note (branch/status/recent commits + cross-agent staleness warnings). |

#### Orchestrator mode

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `CORTEX_MODE` | `persistent` | `persistent` \| `stateless` (clean per request) \| `server` (HTTP client). |
| `CORTEX_SERVER_URL` | `http://localhost:4000` | Server endpoint when `CORTEX_MODE=server`. |

#### Agent workspace

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `AGENT_TMUX_MONITOR` | `false` | tmux visual monitoring for parallel agent teams (one live pane per agent). |

#### Git / PR access control

Governs the `PRAgent` & `WorkspaceManager` tools and the `/v1/pr/*` routes. Input-format validation (which blocks shell/argument injection) is **always** on; the allow-lists are opt-in defense-in-depth.

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `GIT_ALLOWED_REPOS` | — (all) | Comma list of `owner/repo` (supports `owner/*`, `*`). Unset = all repos allowed + a startup warning. Restrict for shared deployments, e.g. `me/app,me/*`. |
| `GIT_ALLOWED_ACTIONS` | — (all) | Comma list of allowed actions: `review,list,create,post-review,clone,worktree,diff,cleanup,status`. |
| `GIT_AUTH_TOKEN` | — | Token for gh/git. Injected into the subprocess env (`GH_TOKEN`/`GITHUB_TOKEN`) only — never on argv or in a URL. Unset = use `gh`'s own auth. |
| `GIT_HOST` | `github.com` | GitHub Enterprise host for the git/PR tools. |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret for `/v1/pr/webhook` (`X-Hub-Signature-256`). Unset = the webhook is disabled (401). |

#### Server lifecycle

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `PORT` | `4000` | HTTP server port (falls back to the next free port if taken). |
| `AUTO_RESUME` | `false` | `true` = resume the most recent session on boot. |
| `RESUME_SESSION_ID` | — | Resume a specific session UUID (overrides `AUTO_RESUME`). |
| `SERVER_IDLE_TIMEOUT` | `0` | Seconds of inactivity before auto-shutdown. `0` = never (always-on daemon). |
| `SHUTDOWN_GRACE_MS` | `10000` | Max ms to drain in-flight connections on shutdown (`0` = wait indefinitely). |
| `ENABLE_DASHBOARD` | `false` | Eagerly start the sandbox+tmux dashboard (binds an extra port). Tools still start it lazily when needed. |
| `DASHBOARD_PORT` | `4001` | Dashboard port (whether started eagerly or lazily). |

#### Runtime flags & debug

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `YOLO` | `false` | Auto-approve **all** tool executions (bypasses the permission system). |
| `DEBUG_PAYLOAD` | `false` | Log raw API request/response payloads. |
| `DEBUG_SYSTEM_MESSAGES` | `false` | Verbose system-message assembly logging (also on with `DEBUG=true`). |
| `DEBUG_THINKING` | `false` | Show thinking/reasoning in the CLI. On Anthropic adaptive-thinking models, `true` requests summarized reasoning and **bills extra output tokens**; `false` keeps it omitted ($0). |
| `ENABLE_SMOKE_TESTS` | `false` | Run real-API smoke tests instead of mocked ones. |

#### Tool & path overrides

| Variable | Default | What it does / how to use it |
|----------|---------|------------------------------|
| `CHROMIUM_BIN` | auto | Override the Chromium binary for web/browse tools. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | auto | Alternate Chromium path honored by Playwright. |
| `TMUX_BIN` | auto | Override the tmux binary for visual agent monitoring. |
| `GOOGLE_CLOUD_PROJECT` | — | Vertex AI project (only when using Vertex instead of the Gemini API). |

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
  "neoncortex": { "theme": "dracula", "defaultModel": "grok-4.3" }
}
```

A per-launcher entry overrides the flat values for that launcher. Behavioral settings (permissions, MCP auto-inject, debug, etc.) are **not** stored here — those are the `.env` variables above.

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

# Docker (future)
docker build -t nexus-cortex .
docker run -p 4000:4000 -e ANTHROPIC_API_KEY=... nexus-cortex
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

## Migration from V3

Key differences:

| Aspect | V3 | V4 |
|--------|----|----|
| Architecture | HTTP-first | Direct-wired with optional server |
| Session Storage | SQLite | JSONL |
| Performance | ~15ms per operation | ~1ms per operation (direct mode) |
| Context System | None | CORTEX.md auto-generation |
| System Messages | Basic | Auto-loading with hot-reload |
| Themes | 2 themes | 15 professional themes |
| MCP Support | Limited | Full integration |
| Tool Execution | HTTP requests | Direct library calls |

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

## Credits

Built as a clean-room TypeScript multi-provider harness.

**Cortex Development Team**

---

## Links

- [CORTEX.md](./.cortex/CORTEX.md) - Auto-generated project context
- [Research Docs](./.claude/claude_research_analysis/) - Architecture research

