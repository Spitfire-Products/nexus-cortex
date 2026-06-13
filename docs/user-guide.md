# Nexus Cortex — User Guide

The full headless workflow: the `cortex` CLI, the HTTP agent server, the REST API, sessions,
PR review, deployment, and troubleshooting. For setup see the [README](../README.md); for
internals see [Architecture](architecture.md).

## Install

```bash
# The cortex command + the HTTP server
npm install -g @nexus-cortex/cli @nexus-cortex/server

# Or embed the library
npm install @nexus-cortex/core @nexus-cortex/executors
```

From source (`npm run build` auto-links the global commands):

```bash
npm install && npm run build     # multi-pass build, then links `cortex`
npm run link                     # re-link any time (self-healing)
```

## The `cortex` CLI

`cortex` is a headless command — one-shot or multi-turn natural-language queries, plus a
full structured command set. The first query **auto-starts a local server**; it persists in
the background and subsequent calls share one stateful session.

```bash
# Simple query
cortex "What is this project?"

# Specific model
cortex --model deepseek-v4-flash "Explain TypeScript generics"

# Multi-turn (session persists automatically)
cortex "Remember the launch code is FALCON-42"
cortex "What was the launch code?"

# JSON output for scripting and agent workflows
cortex --json "List the npm scripts" | jq '.content[0].text'

# Session management
cortex --sessions                          # List all sessions
cortex --stats                             # Current session stats
cortex --new "Start a fresh conversation"  # New session
cortex --resume SESSION_ID "Continue here" # Resume a specific session
cortex --quiet "Just the answer"           # Response only, no metadata
```

### Autonomous agent (one-shot)

`cortex agent` (alias `cortex run`) runs one task to completion and exits — fresh session,
auto-approves tools (headless has no interactive approver), self-stops the server on idle.
Point it at a throwaway/worktree/sandbox dir on a real repo.

```bash
cortex agent "summarize the test gaps in this repo"
cortex agent --cwd ./feature-branch "add a --version flag and run the tests"
cortex run --json "fix the failing lint" | jq '.toolUses[].name'
```

### Command groups

Run `cortex --help`, or `cortex <group> --help` for any group:

| Group | What it does |
|-------|--------------|
| `cortex "<prompt>"` | One-shot query (`-m/--model`, `--system`, `--max-tokens`, `--json`) |
| `cortex agent` / `run` | Autonomous one-shot agent (`--cwd`, `--json`) |
| `models` | `list` / `info` / `search` / `compare` / `cost` / `providers` / `switch` |
| `sessions` | `list` / `view` / `export` / `resume` / `checkpoints` / `stats` / `search` / `compact` |
| `config` | `get` / `set` / `categories` / `category` / `reset` |
| `mcp` | `list` / `status` / `tools` / `enable` / `disable` / `init` / `validate` / `edit` |
| `permissions` | `mode` / `set` / `grant` / `revoke` / `policies` / `tools` / `auto-approve` |
| `autoresearch` | `bench` / `experiment` / `evaluate` / `fix` / `list` |
| `context` | `status` / `compact` / `boundaries` / `strategy` / `savings` |
| `middleware` | `list` / `status` / `enable` / `disable` / `config` |
| `artifact` | `list` / `status` / `restart` / `stop` |
| `tmux` | `list` |
| `tools` | `list` / `info` |
| `cache` | `metrics` |
| `system-messages` | `list` / `view` / `reload` |
| `server` | `status` / `start` |

### Agent team usage

The session ID enables multi-turn agent workflows:

```bash
SESSION=$(cortex --quiet --json "Analyze test gaps" | jq -r '.sessionId')
cortex --resume $SESSION "Now fix the top priority gap"
cortex --resume $SESSION "Run the tests to verify"
```

> **Interactive terminal UIs — Release 2.** A React/Ink chat UI (`neoncortex`), a Chalk UI
> (`fuzzycortex`), the slash-command set, and a color-theme system ship in `@nexus-cortex/tui`
> in the next release. Release 1 is headless-only.

## Running the HTTP server

The server is a **stateful agent** — sequential requests share one persistent session with
full conversation history, tool execution, and context management. No terminal UI required.

```bash
# Production (uses DEFAULT_MODEL_ID from .env)
cortex-server &
# or, from source:
node packages/server/dist/index.js &

# Override model at launch
DEFAULT_MODEL_ID=grok-4-1-fast-reasoning cortex-server &

# Dev mode (auto-restart on code changes, auto-resumes session)
cd packages/server && npm run dev
```

Port 4000 = API server. The HTML dashboard (sandbox/tmux viewer, port 4001) is opt-in: set
`ENABLE_DASHBOARD=true` — a master switch, so when off no second port is ever bound.

### Direct HTTP (curl)

```bash
# Send a message
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"Read package.json and tell me the version"}]}'

# Multi-turn: the next request continues the same conversation
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"What dependencies does it have?"}]}'
```

### Response fields

| Field | Description |
|-------|-------------|
| `content[]` | Model text response |
| `toolUses[]` | Tools called (name, input, result) |
| `usage.inputTokens` | Total input tokens (reveals system message overhead) |
| `usage.outputTokens` | Response size |
| `usage.cache` | Cache hit rate and cost savings |
| `metadata.toolCallIterations` | Tool round-trips |

### Session management API

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
Session routes also include `export`, `DELETE`, `checkpoints`, `load`, `resume`, `context`,
and `compaction/boundaries`.

### PR review API

When the git/PR tools are configured (see [Architecture → Permission System](architecture.md)):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/pr/review` | POST | Run a PR review pipeline (`{repo, prNumber, options?}`) |
| `/v1/pr/create` | POST | Drive PR creation in an isolated worktree (`{repo, branch?, description?}`) |
| `/v1/pr/list` | GET | List open PRs (`?repo=owner/repo`) |
| `/v1/pr/webhook` | POST | GitHub webhook — requires `GITHUB_WEBHOOK_SECRET` + a valid `X-Hub-Signature-256` (returns 401 if no secret is set) |

### Server lifecycle

The server does **not** auto-shutdown after responses (unless `--idle-timeout` is set). Stop it explicitly:

```bash
pkill -f "packages/server/dist/index.js"   # or Ctrl+C if foreground
```

**Session resume**: by default the server starts a **fresh** session on boot. Opt into resuming:

| Variable | Default | Behavior |
|----------|---------|----------|
| `AUTO_RESUME` | `false` | `true` → resume the most recent session on startup |
| `RESUME_SESSION_ID` | — | Resume a specific session by UUID (overrides `AUTO_RESUME`) |

With `AUTO_RESUME=true`, `tsx watch` restarts (dev mode) seamlessly continue your conversation —
code changes take effect without losing session state. Pair it with `SERVER_IDLE_TIMEOUT` for a
"sleep when idle, resume on wake" daemon.

### Common launch variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_MODEL_ID` | `deepseek-v4-pro` | Model to use (any registry ID or alias) |
| `PORT` | `4000` | Server port (falls back to the next free port if taken) |
| `DEBUG` | `false` | Verbose logging (system messages, routes) |
| `YOLO` | `false` | Auto-approve all tool executions (bypasses permissions) |
| `CORTEX_MODE` | `persistent` | `stateless` for clean per-request sessions; `server` for HTTP-client mode |
| `ENABLE_DASHBOARD` | `false` | Master switch for the sandbox/tmux web dashboard (binds `DASHBOARD_PORT`, default 4001) |

Every variable is documented in [Configuration](configuration.md) and in `.env.example`. Run
`cortex-server --help` for the server's own summary.

## Development

```bash
npm run clean        # Clean build artifacts
npm run build        # Build all packages (multi-pass; see Architecture)
npm run typecheck    # Type checking
npm test             # Run tests
npm run test:ci      # Tests with coverage
npm run lint         # Lint
```

### Dev workflow (stateful iteration)

The recommended loop uses the server in dev mode with auto-resume:

```bash
# Terminal 1: server with hot reload
cd packages/server && npm run dev

# Terminal 2: send messages (each builds on the last)
cortex "Read the orchestrator and explain the tool loop"
cortex "Now add logging before each tool call"
cortex "Run the tests to verify"
```

What survives restarts: **system-message edits** (read fresh each turn), **code changes**
(tsx watch restarts + auto-resumes from JSONL), and **session state** (history, cache metrics,
turn count restored from disk).

## Production deployment

```bash
# Production server
NODE_ENV=production PORT=4000 cortex-server

# With PM2
pm2 start packages/server/dist/index.js --name nexus-cortex
```

## Troubleshooting

**Build errors** — clean and rebuild:
```bash
npm run clean && npm run build
```

**TypeScript errors** — `npm run typecheck`; ensure array accesses guard for `undefined`.

**MCP server issues** — test the server manually and check config:
```bash
npx -y @modelcontextprotocol/server-filesystem /path/to/dir
cat .cortex/mcp_config.json
```

**Missing API keys** — confirm the keys for the providers you use are set:
```bash
echo $ANTHROPIC_API_KEY
```

> `CORTEX.md` (project context) is generated on demand in your own project — run `/init` or
> the `InitCortexContext` tool; it is not shipped with the package.
