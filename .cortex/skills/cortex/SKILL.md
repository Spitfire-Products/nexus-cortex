---
name: cortex
description: Dispatch tasks to the Nexus Cortex server for parallel testing, evaluation, and agent-to-agent workflows.
triggers:
  - cortex
  - test via cortex
  - dispatch to cortex
  - evaluate performance
  - cortex agent
  - parallel test
  - send to cortex
---

# Cortex — Nexus Cortex Headless Agent

Global command: `cortex`
Server: `http://localhost:4000` (auto-starts on first call, ~10s boot)
Entry: `<repo-root>/packages/cli/bin/cortex.js`
Server entry: `<repo-root>/packages/server/dist/index.js`
Server log: `/tmp/cortex-server.log`
Sessions: `.cortex/sessions/{uuid}.jsonl`
Working directory: the repo root

Sessions are stateful — each call continues the conversation. Use `--new` for isolation.

The model has its own session tools (ListSessions, LoadSession, SearchConversationHistory, RequestHistoricalContext) — for session recall, just ask in natural language instead of using `--resume`:
```
cortex --new "Search your conversation history for what we discussed about caching"
```

## Flags

### Dispatch
```
--model, -m ID       Model override
--new                Fresh session
--resume ID          Resume session by UUID
--stream             SSE streaming (text→stdout, tools/thinking→stderr)
--json               Full JSON response
--quiet, -q          Text only, no footer
--output FILE        Write response to file
--pr MODE REPO [N]   PR management (review/create/list owner/repo [prNumber])
```

### Request Tuning
```
--max-tokens N       Max response tokens (default: 4096)
--temperature N      0.0-2.0 (default: 1.0)
--max-iterations N   Tool loop limit (default: 10000)
--timeout N          Abort after N ms
--system "msg"       System message injection
--tools t1,t2,t3    Restrict to named tools
--no-tools           Pure chat (no tool use)
--auto-approve       YOLO mode for tool execution
```

### Server
```
--port, -p PORT      Server port (default: 4000)
--debug              Debug logging
--no-resume          Server starts without auto-resume
--env KEY=VALUE      Set server env var (repeatable)
```

### Introspection (no prompt needed)
```
--list-models        Models grouped by provider
--list-tools         All registered tools with descriptions
--sessions           All sessions with age/message counts
--stats              Current session stats
--context            Token budget utilization
--cache-metrics      Cache hit rate and savings
--export ID          Export session to JSON
```

## Headless API Schema

```bash
# Non-streaming
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"PROMPT"}]}'

# Streaming (SSE)
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"PROMPT"}],"stream":true}'
```

**Request body fields:**
| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Model ID (falls back to DEFAULT_MODEL_ID) |
| `messages` | array | `[{role: "user", content: "..."}]` |
| `system` | string | System message override |
| `tools` | array | Tool name list (empty `[]` = all built-in tools) |
| `max_tokens` | number | Max response tokens (default: 4096) |
| `temperature` | number | 0.0-2.0 (default: 1.0) |
| `top_p` | number | Nucleus sampling (default: 1.0) |
| `stream` | boolean | Enable SSE streaming |

**JSON response:**
```json
{
  "content": [{"type": "text", "text": "..."}],
  "toolUses": [{"name": "Read", "input": {"file_path": "..."}}],
  "usage": {
    "inputTokens": 5000, "outputTokens": 1200,
    "cache": {"cacheHitRate": 0.85, "costSavingsRatio": 0.64}
  },
  "metadata": {"toolCallIterations": 3},
  "model": {"id": "grok-4-1-fast-reasoning", "provider": "xai"}
}
```

**SSE event types:** `message_start`, `content_block_start`, `text_delta` (delta field = text string), `thinking_delta`, `tool_use_complete` (toolUse.name), `tool_result` (toolResult.content, toolResult.is_error), `message_delta` (usage), `message_stop`, `error`

## Server Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/v1/messages` | POST | Send message (streaming or not) |
| `/models` | GET | List all models (`{data: [...]}`) |
| `/tools` | GET | List all tools (`{tools: [...]}`) |
| `/sessions` | GET | List sessions |
| `/sessions/new` | POST | Create new session |
| `/sessions/:id/stats` | GET | Session statistics |
| `/sessions/:id/context` | GET | Token budget info |
| `/sessions/:id/cache/metrics` | GET | Cache metrics |
| `/sessions/:id/export` | GET | Full session export |
| `/sessions/:id/model` | PUT | Switch model mid-session |
| `/sessions/:id/resume` | POST | Resume session (no body) or checkpoint (`{checkpointId}`) |
| `/v1/pr/review` | POST | Trigger PR review pipeline (`{repo, prNumber}`) |
| `/v1/pr/create` | POST | Trigger PR creation pipeline (`{repo, branch}`) |
| `/v1/pr/list` | GET | List open PRs (`?repo=owner/repo`) |
| `/v1/pr/webhook` | POST | GitHub webhook (future: auto-review on PR open) |

## Tools

Run `cortex --list-tools` (or `GET /tools`) for the authoritative registered list. Categories:
file ops (Read/Write/Edit/Glob/Grep), execution (Bash/BashOutput/KillShell/TmuxSession),
web (WebSearch/WebFetch), agents (Task/WorkspaceManager/PRAgent), session history
(ListSessions/LoadSession/SearchConversationHistory/...), sandbox/artifacts, planning
(TodoWrite/ExitPlanMode), extensions (Skill/SlashCommand), and auto-research
(ResearchBacklog + the `cortex autoresearch` CLI).

## .env Configuration

```bash
# API KEYS (values omitted — set in <repo-root>/.env)
#ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
#GOOGLE_API_KEY=             # legacy fallback for GEMINI_API_KEY
XAI_API_KEY=
DEEPSEEK_API_KEY=

# ANTHROPIC AUTH
ANTHROPIC_AUTH_METHOD=auto   # auto | oauth | api-key
CLAUDE_CODE_OAUTH_TOKEN=     # sk-ant-oat01-... (Claude.ai Max subscription)

# PROMPT CACHING
ANTHROPIC_PROMPT_CACHING=true

# MODELS (example values — run `cortex --list-models` for the registered IDs)
DEFAULT_MODEL_ID=deepseek-v4-pro
HELPER_MODEL_ID=deepseek-v4-flash
WEB_TOOLS_MODEL=gemini-2.5-flash   # Gemini model for WebSearch/WebFetch tools (free built-in googleSearch/urlContext)

# SYSTEM
DEBUG=false
USE_EMOJI=false
PROJECT_PATH=

# REACTIVE MENTORSHIP
MENTORSHIP_ENABLED=true
MENTORSHIP_TRIGGER_ON_ERROR=true
MENTORSHIP_ERROR_THRESHOLD=medium     # low | medium | high
MENTORSHIP_KEYWORDS_ENABLED=true      # @ultrathink, @analyze, @rethink
MENTORSHIP_CUSTOM_KEYWORDS=
MENTORSHIP_HELPER_MODEL=claude-haiku-4-5
MENTORSHIP_TURN_BASED_ENABLED=true
MENTORSHIP_TURN_INTERVAL=10
MENTORSHIP_INTERLEAVED_THINKING=true
MENTORSHIP_PATTERN_DETECTION=true
MENTORSHIP_PATTERN_THRESHOLD=3

# CONTEXT MANAGEMENT
CONTEXT_BUDGET_STRATEGY=sliding-window  # sliding-window | priority-based
REASONING_PATTERN_OPTIMIZATION=true
REASONING_KEEP_RECENT_TURNS=3

# SESSION
SESSION_STORAGE_DIR=.cortex/sessions
MCP_AUTO_INJECT=false

# XAI SERVER SIDE TOOLS
ENABLE_SERVER_SIDE_TOOLS=true  # Injects web_search, x_search, code_execution; overrides to Responses API
XAI_API_MODE=messages          # messages (thinking support) | responses (server-side tools + stateful)

# AGENT TEAM WORKSPACE
AGENT_TMUX_MONITOR=false    # Enable tmux pane visual monitoring for parallel agents

# TESTING
ENABLE_SMOKE_TESTS=false
```

**Runtime variables (not in .env, set at launch):**
`CORTEX_MODE` (direct|stateless|server), `PORT` (4000), `YOLO` (true|false), `AUTO_RESUME` (true|false), `MAX_TOOL_ITERATIONS` (default: 10000), `MAX_CONSECUTIVE_ERRORS` (default: 3), `TOOL_TIMEOUT_MS` (default: 120000), `MAX_LOOP_REPETITIONS` (default: 5), `AGENT_TMUX_MONITOR` (default: false)

## Platform Capabilities

All subsystems accessible via natural language prompts. Control via `.env` or runtime vars.

| Subsystem | Control | What It Does |
|-----------|---------|--------------|
| **Reactive Mentorship** | `MENTORSHIP_*` (11 vars) | AI-to-AI self-improvement. Helper model reviews on errors, keywords (`@ultrathink`, `@analyze`, `@rethink`), or every N turns. Pattern detection for repeated failures. |
| **Context Management** | `CONTEXT_BUDGET_STRATEGY`, `REASONING_*` | Auto-compaction via helper model when context fills. Thinking block optimization for recent turns. Sliding-window or priority-based strategies. |
| **Loop Control** | `MAX_TOOL_ITERATIONS`, `MAX_CONSECUTIVE_ERRORS`, `TOOL_TIMEOUT_MS`, `MAX_LOOP_REPETITIONS` | Identical-call detection (hash name+input), circuit breaker on consecutive errors, configurable timeout per tool. |
| **Prompt Caching** | `ANTHROPIC_PROMPT_CACHING` | Caches system messages and tools. Tracks cache creation/read tokens, hit rate, cost savings ratio. |
| **Sessions** | `SESSION_STORAGE_DIR` | JSONL append-only history. Tools: ListSessions, LoadSession, SearchConversationHistory, GetConversationSegment, RequestHistoricalContext, ListCompactionBoundaries. |
| **Artifacts** | Dashboard on :4001 | Browser-viewable code artifacts. Tools: CreateArtifactTool, InteractWithSandbox, ModifySandbox, InspectSandbox, StopSandbox. Modes: oneshot, dev, persistent. |
| **Tmux Sessions** | `TMUX_BIN` | Persistent terminal sessions. Tool: TmuxSession — create, send commands, capture output, list, kill. Metadata in `.cortex/tmux-sessions/`. |
| **Agent Profiles** | `.cortex/agents/*.md` | Task delegation via Task tool. YAML frontmatter defines name, model, tools, system prompt. Project agents override personal (`~/.cortex/agents/`). |
| **Permissions** | `.cortex/permissions.*.json`, `YOLO` | 3 profiles (dev/test/prod). 4 policy types: Whitelist, Blacklist, FileOperation, BashCommand. Audit logging. |
| **System Messages** | `.cortex/system-messages/` | Priority-ordered custom prompts. Hot-reload via file watching. CORTEX.md + MEMORY.md auto-injected every turn. |
| **MCP Servers** | `MCP_AUTO_INJECT` | Multi-server Model Context Protocol. Auto-injection or on-demand. Tool names prefixed: `serverName__toolName`. |
| **Slash Commands** | `.cortex/commands/*.md` | SlashCommand tool loads templates with `$1`/`$2` substitution. 9 installed (review, test, diff, deps, find-bug, explain, profile, compare, search). |
| **Debug** | `DEBUG` | Verbose logging. Shows system message injection, adapter selection, tool execution details. |
| **XAI Server Tools** | `ENABLE_SERVER_SIDE_TOOLS`, `XAI_API_MODE` | Hybrid tool mode: server-side (web_search, x_search, code_execution) auto-execute on xAI; client-side tools (Read, Write, Bash) pause and return. System messages extracted to `instructions` for caching. |
| **Agent Team Workspace** | `AGENT_TMUX_MONITOR` | Git worktree isolation for multi-agent collaboration. WorkspaceManager tool manages `git worktree add/remove` for per-agent workspaces. Team briefing prepended to agent prompts. Result broadcasting forwards completed agent findings to still-running siblings. |
| **Cross-Agent Communication** | Mentorship IPC | Orchestrator-mediated guidance injection via `injectGuidance()` / `broadcastGuidance()`. Uses dual-path: thinking blocks (Google GenerateContent) or `<system-reminder>` tags (Anthropic, OpenAI, XAI). Reuses mentorship infrastructure. |
| **PR Management** | PRAgent tool, `--pr` flag | Review, create, list, and post-review for GitHub PRs via `gh` CLI. Dispatches parallel audit agents (security, quality, architecture). Server routes at `/v1/pr/*`. |

## Agent Team Workspace System

### Architecture — 3 Layers

```
Layer 3: Use Cases (PR Review, Internal Dev, Multi-Repo)
  PRAgent tool, cortex --pr CLI, server routes at /v1/pr/*
Layer 2: Team Communication
  Guidance injection, team briefing, result broadcasting, orchestrator-mediated messaging
Layer 1: Workspace Isolation
  WorkspaceManager tool (git worktree lifecycle), per-agent worktree paths in task prompts
```

### Implementation Files

| Component | File | Purpose |
|-----------|------|---------|
| **WorkspaceManager executor** | `packages/executors/src/implementations/execution/WorkspaceManagerTool.ts` | Git worktree lifecycle (create/clone/status/diff/cleanup) |
| **PRAgent executor** | `packages/executors/src/implementations/agent/PRAgentTool.ts` | GitHub PR operations via `gh` CLI |
| **Tool definitions** | `packages/core/src/tools/registries/BaseToolRegistry.ts` | Schema registration for both tools |
| **Executor registration** | `packages/executors/src/ExecutorRegistry.ts` | Executor registration for both tools |
| **Guidance injection (sub-agent)** | `packages/cli/src/agent-mode.ts` | `pendingGuidance` queue + `orchestrator.injectGuidance()` call |
| **injectGuidance (orchestrator)** | `packages/core/src/orchestrator/CortexOrchestrator.ts` | Public method reusing `injectThinkingBlock()` dual-path |
| **broadcastGuidance** | `packages/core/src/orchestrator/SubAgentProcessManager.ts` | Sends IPC guidance to all active agents except excluded |
| **Team briefing** | `packages/core/src/orchestrator/CortexOrchestrator.ts` | `injectTeamBriefing()` — prepends briefing to Task prompts when >1 Task tools dispatched |
| **PR server routes** | `packages/server/src/routes/pr.ts` | 4 REST endpoints for PR management |
| **PR CLI flag** | `packages/cli/bin/cortex.js` | `--pr MODE REPO [N]` shorthand |
| **PR agent definitions** | `.cortex/agents/pr-*.md` (5 files) | Security, quality, architecture, implementer, test-writer |

### WorkspaceManager Tool Reference

**Modes:**

| Mode | Required Params | What It Does | Returns |
|------|----------------|-------------|---------|
| `create` | — | `git worktree add /tmp/workspace-{uuid} -b {branch} {baseBranch}` from local repo | `{ worktreePath, branch, baseBranch, repoPath }` |
| `clone` | `repo` | `git clone --depth 50` external repo, optionally creates worktree branch | `{ cloneDir, worktreePath, branch, repo }` |
| `status` | — | `git worktree list --porcelain` → parsed worktree list | `{ worktreeCount, worktrees: [{ path, head, branch }] }` |
| `diff` | `worktreePath` | `git diff {baseBranch} -- .` with file list | `{ changedFiles, fileCount, diffLines, truncated, diff }` |
| `cleanup` | `worktreePath` | `git worktree remove --force` + `git worktree prune` | `{ worktreePath, removed: true }` |

**Parameters:**
```typescript
{
  mode: 'create' | 'clone' | 'status' | 'diff' | 'cleanup',
  repo?: string,         // Local path for create, "owner/repo" for clone
  branch?: string,       // Branch name (auto-generated if omitted: workspace-{uuid})
  baseBranch?: string,   // Compare target (default: main)
  worktreePath?: string, // Required for diff/cleanup
  maxDiffLines?: number  // Truncation limit (default: 5000)
}
```

**Key behaviors:**
- `create` falls back to HEAD if baseBranch doesn't exist
- `clone` uses shallow clone (`--depth 50`) with 120s timeout
- `clone` auto-detects clone URL format (owner/repo → `https://github.com/{repo}.git`)
- `cleanup` force-removes even if `git worktree remove` fails (fallback: `rmSync`)
- Worktrees created in `/tmp/workspace-{uuid}` (ephemeral)

### PRAgent Tool Reference

**Requires:** GitHub CLI (`gh`) installed and authenticated.

**Modes:**

| Mode | Required Params | What It Does | Returns |
|------|----------------|-------------|---------|
| `review` | `repo`, `prNumber` | `gh pr view --json` + `gh pr diff` | `{ title, author, stats, files, diff, labels, reviewDecision }` |
| `create` | `repo` | Returns context for orchestrator to set up workspace + dispatch agents | `{ repo, branch, instructions }` |
| `list` | `repo` | `gh pr list --json --limit 50` | `{ count, pullRequests: [{ number, title, author, labels, isDraft }] }` |
| `post-review` | `repo`, `prNumber`, `action` | `gh pr review {N} {--approve|--request-changes|--comment}` | `{ action, posted: true }` |

**Parameters:**
```typescript
{
  repo: string,                     // "owner/repo" format (required)
  mode: 'review' | 'create' | 'list' | 'post-review',
  prNumber?: number,                // Required for review/post-review
  branch?: string,                  // For create mode
  action?: 'approve' | 'request-changes' | 'comment',  // For post-review
  body?: string,                    // Comment body for post-review
  diffOptions?: { pathFilter?: string, maxLines?: number }
}
```

**Key behaviors:**
- `review` returns structured PR context (metadata + diff) for the LLM to dispatch audit agents
- `review` supports `pathFilter` to filter diff to specific file paths
- `create` does NOT set `shouldSpawnSubAgent` — returns context for orchestrator to decide
- `post-review` maps action to `gh pr review` flags

### Agent Dispatch Modes

4 modes for spawning sub-agents via the Task tool. Team mode activates automatically when >1 Task tools are dispatched in the same turn.

| Mode | Agents | Communication | Workspace |
|------|--------|--------------|-----------|
| **Solo** | 1 | None | Shared |
| **Parallel** | N | None | Shared |
| **Team** | N | Briefing + Result Broadcasting | Shared |
| **Git Worktree** | N | Briefing + Result Broadcasting | Isolated per agent |

### Solo — Single Agent
```bash
cortex --quiet "Use the code-reviewer agent to review APIClient.ts"
```

### Parallel — Independent Concurrent Agents
```bash
cortex --quiet "Use 3 explore agents to search for: WebSocket code, auth middleware, rate limiting"
```

### Team — Coordinated Agents with Cross-Communication
```bash
# PR review dispatches 3 audit agents as a team
cortex --pr review owner/repo 42

# Custom team
cortex --quiet "Dispatch pr-security-auditor, pr-code-quality, and pr-architecture-reviewer as a team to review the auth module"
```

Team mode auto-injects a **team briefing** (teammate names, assignments) into each agent's prompt. When an agent completes, `broadcastGuidance()` forwards its findings to still-running siblings via IPC → `injectGuidance()` → `<system-reminder>` or thinking block.

**Team briefing format** (auto-prepended to each agent's prompt):
```
📋 **Team Briefing**
You are part of a {N}-agent team working in parallel.

Teammates:
- {agentType}: {description}
- {agentType}: {description}

The orchestrator will forward relevant findings from teammates.
Focus on YOUR assignment. Do not duplicate others' work.
```

### Git Worktree — Isolated Workspaces per Agent
```bash
# Create isolated worktrees, dispatch agents to each
cortex --quiet "Use WorkspaceManager to create worktrees for branches auth-refactor and api-cleanup, then dispatch pr-implementer agents to each"
```

**Full workspace lifecycle:**
1. `WorkspaceManager(mode=create, branch=X)` → `/tmp/workspace-{uuid}`
2. `WorkspaceManager(mode=create, branch=Y)` → `/tmp/workspace-{uuid}`
3. Team briefing injected with workspace paths
4. Agents dispatched in parallel via `Promise.allSettled`
5. Early-completion agent's findings broadcast to still-running siblings
6. `WorkspaceManager(mode=diff, worktreePath=...)` for each
7. `WorkspaceManager(mode=cleanup, worktreePath=...)` for each

### Cross-Agent Communication Flow

```
Agent A completes
    ↓
CortexOrchestrator detects completion
    ↓
Constructs broadcast: "📡 Team Update: Agent 'A' completed: {summary (max 500 chars)}"
    ↓
SubAgentProcessManager.broadcastGuidance(message, excludeAgentId=A)
    ↓
For each active agent B, C, ...:
    SubAgentProcessManager.guideAgent(agentId, message)
        ↓
    IPC: parent.send({ type: 'guidance', payload: { message } })
        ↓
    agent-mode.ts: pendingGuidance.push(message)
        ↓
    orchestrator.injectGuidance(message, 'team_update')
        ↓
    Dual-path injection (same as mentorship thinking):
      - Thinking-capable APIs → thinking block
      - Other APIs → <system-reminder> tag
        ↓
    Ephemeral message (metadata.ephemeral=true) — cleaned up after turn
```

### Visual Monitoring
```bash
AGENT_TMUX_MONITOR=true cortex --quiet "Dispatch 3 agents..."
# View: http://localhost:4001/tmux/team-{id} or tmux attach -t team-{id}
```

Events mirrored to tmux panes: `▶️ Started`, `🔧 Read /path`, `✅ Completed (15.2s)`, `❌ Error`

### PR Management

**CLI shorthand:**
```bash
cortex --pr review owner/repo 42     # Review PR (dispatches audit team)
cortex --pr list owner/repo          # List open PRs
cortex --pr create owner/repo --branch feature-x  # Create PR workflow
```

**Server routes:**

| Route | Method | Body/Query | Pipeline |
|-------|--------|-----------|----------|
| `/v1/pr/review` | POST | `{ repo, prNumber, options? }` | PRAgent(review) → 3 parallel audit agents → synthesize → result |
| `/v1/pr/create` | POST | `{ repo, branch?, description? }` | WorkspaceManager(create) → PRAgent(create) → pr-implementer agent |
| `/v1/pr/list` | GET | `?repo=owner/repo` | PRAgent(list) → formatted results |
| `/v1/pr/webhook` | POST | GitHub webhook payload | Future: auto-review on `pull_request.opened` |

**PR review pipeline (3 parallel agents):**
1. PRAgent(mode=review) fetches PR metadata + diff
2. Orchestrator dispatches 3 agents as a team:
   - `pr-security-auditor` — vulnerabilities, malicious code, supply chain risks
   - `pr-code-quality` — style, complexity, anti-patterns, test gaps
   - `pr-architecture-reviewer` — breaking changes, API surface, dependency impact
3. Early completions broadcast to still-running siblings
4. Orchestrator synthesizes findings → approve or request changes
5. PRAgent(mode=post-review) posts the review

**PR agent definitions** (in `.cortex/agents/`):

| Agent | Tools | Focus |
|-------|-------|-------|
| `pr-security-auditor` | Grep, Read, Bash | Vulnerabilities, malicious code, prompt injection, supply chain |
| `pr-code-quality` | Read, Grep, Glob | Style, complexity, anti-patterns, test coverage gaps |
| `pr-architecture-reviewer` | Read, Grep, Glob, Bash | Breaking changes, API surface, dependency impact |
| `pr-implementer` | Read, Edit, Write, Bash, Grep, Glob | Implement code changes in worktree |
| `pr-test-writer` | Read, Write, Edit, Bash, Grep, Glob | Write tests for changes |

### Test Coverage

The team-workspace system is covered by dedicated test suites:

| Test File | What It Covers |
|-----------|---------------|
| `packages/core/src/orchestrator/__tests__/TeamWorkspace.test.ts` | Team briefing, guidance injection, broadcast guidance, tmux binary resolution, `AGENT_TMUX_MONITOR` env handling, result broadcasting, ephemeral message lifecycle, agent-mode guidance handler |
| `packages/core/src/orchestrator/__tests__/AgentDispatchLifecycle.test.ts` | Solo + parallel dispatch, team briefing + cross-agent broadcasting + event routing, IPC protocol messages + guidance flow, error handling, SubAgentProcessManager state, tmux monitoring |

**Run tests (from the repo root):**
```bash
npm test              # Watch mode
npm run test:run      # Single run
```

Full agent documentation: `.cortex/agents/README.md`

## XAI Responses API + Server-Side Tools

**Env vars:** `ENABLE_SERVER_SIDE_TOOLS=true` (dynamic override) and `XAI_API_MODE=messages|responses` (static config)

**How it works:**
1. `XAI_API_MODE` sets the default API pattern at model registration time. `messages` preserves interleaved thinking; `responses` enables stateful/server-side features.
2. `ENABLE_SERVER_SIDE_TOOLS=true` overrides to Responses API at request time regardless of `XAI_API_MODE`. It injects `web_search`, `x_search`, `code_execution` into the tool array, detection fires, and the orchestrator switches the endpoint + adapter dynamically.
3. **Hybrid tool mode**: Server-side tools auto-execute on xAI servers; client-side tools (Read, Write, Bash, etc.) pause and return `function_call` to the orchestrator's tool loop. Both coexist in the same request.

**System message architecture:**
- `SystemMessageMiddleware` injects system context (CORTEX.md, CLAUDE.md, tool guides) as `<system-reminder>` tags in user message content. This is the universal path for ALL adapters.
- For Responses API only: `APIClient.extractSystemRemindersForResponsesAPI()` scans input items, extracts `<system-reminder>` content, strips tags from user messages, and sets the extracted text as the `instructions` parameter. This enables provider-side caching without duplicating content.
- Messages API, Chat Completions, GenerateContent are unaffected — system context stays embedded in user content.

**Key files:**
| File | Role |
|------|------|
| `packages/core/src/adapters/ServerSideToolDetection.ts` | `shouldUseServerSideTools()` — checks env + model + tools, returns endpoint override |
| `packages/core/src/models/configurators/XAIConfigurator.ts` | Static config from `XAI_API_MODE`, defaults from `SettingsSchema` |
| `packages/core/src/orchestrator/CortexOrchestrator.ts` | Server-side tool injection + detection + `effectiveModel` override |
| `packages/core/src/orchestrator/APIClient.ts` `extractSystemRemindersForResponsesAPI()` | System message extraction for `instructions` param |
| `packages/core/src/adapters/ResponsesAPIAdapter.ts` | Format adapter: `function_call` as top-level items, `function_call_output` for tool results |
| `packages/core/src/tools/ServerSideTools.ts` | `web_search`, `x_search`, `code_execution` definitions + `separateTools()` |

**Installed agents:** plan, explore, code-reviewer, context-research, doc-writer, test-writer, refactor, new-model-api-integrator-analyst, a-frontend-landing-page-designer, pr-security-auditor, pr-code-quality, pr-architecture-reviewer, pr-implementer, pr-test-writer

**75+ models across 13 providers:** Anthropic, OpenAI, Google Gemini, XAI, DeepSeek, Gemma, GLM, Qwen, Moonshot, MiniMax, HuggingFace, Local, OpenRouter

## XAI Cache-Hit Contract (authoritative)

Per live XAI docs (`docs.x.ai/api/mcp` MCP server — search for "prompt-caching"), these are the **hard rules** for maximizing cache hits on reasoning models. Violating any of them is the top cause of slow/expensive XAI inference.

### Rule 1: Never modify earlier messages
> "For cache hits in multi-turn conversations, never edit, remove, or reorder earlier messages — only append new ones."

What would break it in our codebase (all currently guarded):
- `keepRecentThinking()` stripping old thinking blocks → bypassed for XAI reasoning models (CortexOrchestrator.ts, `ensureHistoryFitsModel`)
- Any compaction that rewrites middle messages
- Mentorship injection that adds messages in the middle (our mentorship appends to the end — safe)

### Rule 2: For reasoning models, reasoning_content MUST be sent back
> "For reasoning models, you MUST include reasoning_content from previous responses; omitting it is the TOP cause of cache misses."

Coverage:
- Messages API (grok-code-fast-1, grok-4-1-fast-reasoning via /v1/messages): MessagesAPIAdapter.toProviderMessages preserves `thinking` block + `signature` for XAI. Commit 3e2ec22be.
- Responses API: `reasoning` output items round-tripped as `reasoning` input items in ResponsesAPIAdapter.toProviderMessages.

### Rule 3: Sticky routing via headers/fields
> "Use x-grok-conv-id to maximize cache hit rates."

| API | Routing mechanism | Our implementation |
|-----|-------------------|-------------------|
| Chat Completions / Messages API | `x-grok-conv-id` HTTP header | set from `conversationId = currentSessionId` in PreparedRequest (commit 054f0384d) |
| Responses API | `prompt_cache_key` body field | same conversationId, mapped inside APIClient.sendResponsesAPI |

### Rule 4: Chaining with `previous_response_id` = send only NEW messages
> "With Responses API, we can send the id of the previous response, and the new messages to append to it."

Official example:
```python
second_response = client.responses.create(
    previous_response_id=response.id,
    input=[{"role": "user", "content": "new message"}],  # NOT the full history
)
```

Our implementation (commits e85b68834, 72c656b24):
- Track `messageCountAtLastResponse` as a checkpoint index after every assistant response lands in messageHistory
- When lastResponseId is set AND effectiveModel.api.pattern === 'responses', slice `messageHistory.slice(checkpoint)` as input
- Fires at BOTH initial request time (cross-turn chain) AND continuation request time (within-turn tool loop)
- Debug log: `[Orchestrator] Input-sliced initial request for cross-turn chain: sent 1/N messages`

### Rule 5: Two options for persistence — don't mix them

**Server-side (our default)**: `previous_response_id` + sliced input. Server stores reasoning for 30 days.

**Client-side (for >30-day persistence)**: `include: ["reasoning.encrypted_content"]` on the FIRST request, then splat `*response.output` into the NEXT request's input — **NO `previous_response_id`**. Deferred implementation.

Combining these (our earlier mistake): request shape confuses the server → empty output + reasoning-dominant tokens.

### Measured peak efficiency (2026-04-21)

After all improvements, 3-turn benchmarks show:

| API | Hit rate T2 | Hit rate T3 | Cost savings |
|-----|------------|------------|--------------|
| Messages API (grok-code-fast-1) | 87.7% | 88.2% | ~66% |
| Responses API (grok-4-1-fast-reasoning, server-side tools) | 97.3% | 92.3% | ~70% |

Responses API continuation also sends **1/3 to 1/7 fewer messages** per request due to input slicing.

### Debug log markers for XAI optimization paths

Add these to the path-verification table in the Testing section:

| Marker | Meaning |
|--------|---------|
| `[Orchestrator Context] Skipping thinking block stripping — XAI reasoning model` | Rule 1 compliance active |
| `[Orchestrator] Input-sliced initial request for cross-turn chain: sent N/M messages` | Rule 4 cross-turn chain active |
| `[Orchestrator Phase 2.5] Input-sliced for previous_response_id: sent N/M messages` | Rule 4 within-turn chain active |
| `[Orchestrator Cache] Cache hit detected: { ... hitRate: 'N%' }` | Cache working (fires for both Messages + Responses API paths now) |
| `prompt_cache_key: '<uuid>'` | Rule 3 Responses API routing active |
| `x-grok-conv-id` header in XAI Anthropic-compat client | Rule 3 Messages API routing active |

## Server Management

```bash
# Auto-starts on first cortex call. Manual control:
# IMPORTANT: a manual launcher that `cd`s into packages/server runs argv
# `node dist/index.js` (relative) — `pkill -f "packages/server/dist/index.js"`
# NEVER matches that and fails silently, leaving a zombie that wins the port
# race. Match the real argv:
pkill -9 -f "node dist/index.js"                        # stop (verify with ps!)
ps -eo pid,args | grep "[d]ist/index.js"                # MUST be empty after
curl -s http://localhost:4000/health                    # check
tail -20 /tmp/cortex-server.log                     # debug
```

### Manual start with env overrides

When testing a conditional code path (e.g., Responses API, server-side tools, specific models), start the server manually with the env vars inline — do NOT rely on `.env` alone, since `.env` captures steady-state config, not per-test overrides:

```bash
# Kill old server first — MUST match the real argv (see Server Management
# note above); verify it's actually gone or you'll benchmark a zombie.
pkill -9 -f "node dist/index.js" 2>/dev/null; sleep 2
ps -eo pid,args | grep "[d]ist/index.js" && echo "STILL ALIVE — kill -9 it" || echo "clean"

# Start with test-specific env. setsid fully detaches node from the
# Bash-tool process group (a plain `&`/`disown` child gets reaped when the
# tool call returns — the server dies before you can curl it).
cd <repo-root>/packages/server && \
  DEBUG=true \
  ENABLE_SERVER_SIDE_TOOLS=true \
  XAI_API_MODE=responses \
  CORTEX_MODE=stateless \
  setsid nohup node dist/index.js > /tmp/cortex-server.log 2>&1 < /dev/null &

# Boot can take ~20s on a cold start (not 5s). Poll, don't fixed-sleep:
for i in $(seq 1 30); do sleep 2; curl -sf http://localhost:4000/health >/dev/null && break; done
curl -s http://localhost:4000/health | head -c 150
```

Key env toggles for path testing:
- `DEBUG=true` — verbose logs (required for marker inspection below)
- `ENABLE_SERVER_SIDE_TOOLS=true` — injects `web_search`/`x_search`/`code_execution` + forces Responses API for XAI
- `XAI_API_MODE=messages|responses` — default pattern when server-side tools aren't injected
- `ANTHROPIC_PROMPT_CACHING=false` — disable to measure uncached cost baselines
- `MENTORSHIP_ENABLED=false` — disable AI-to-AI loops when isolating provider behavior

## Testing & Benchmarking Workflow

The proven pattern for testing CORTEX changes (coherence fixes, new providers, prompt-engineering, tool additions): **drive the server with natural-language prompts + run a parallel sub-agent + ground-truth both.** Never trust a single output.

### Cardinal rules (read first — these are non-negotiable, learned the hard way)

1. **n ≥ 2, with *different* prompts.** One task agreeing three ways is a false positive waiting to happen. Run the full pattern with at least two *different* tasks in *fresh sessions*. A single run never decides anything — it confirms nothing and refutes nothing.
2. **Ground-truth everything against the real artifact.** The parallel sub-agent is a *reference that fails differently*, not an oracle. Even an Opus gold sub-agent is not infallible. The only truth is direct shell/grep/python on the actual files. Neither agent's output is self-verifying.
3. **Fresh server + fresh session per run.** `--new` on every prompt; restart the server between *model* probes. Prompt cache and the debug log bleed across models and corrupt cross-model comparisons.
4. **Discard confounded runs — don't average them in.** After every run: `grep -nE "429|capacity|exhausted|rate.?limit|overloaded|quota" /tmp/cortex-server.log`. If it hits, the model was throttled, not benchmarked. Throw the result away and re-run; never fold a confounded run into a tally.
5. **Real work surface, not toy prompts.** The task must (a) move the harness/platform forward *and* (b) have an independently verifiable answer. "Count imports in file X" is verifiable but worthless; "refactor module Z" is real but unverifiable. The skill is finding tasks that are *both* — real work whose result can still be ground-truthed.

### The three-way pattern

```
              ┌─────────────────────────────┐
   same task  │  1. CORTEX (system under    │
  ───────────>│     test) via cortex CLI    │──┐
              └─────────────────────────────┘  │
              ┌─────────────────────────────┐  │  compare
   same task  │  2. Claude Code Agent tool  │──┼──────────> ground truth
  ───────────>│     (reference, different   │  │     via direct shell/grep/python
              │     model — Haiku, Sonnet,  │  │
              │     Opus — they fail        │  │
              │     differently)            │  │
              └─────────────────────────────┘  │
              ┌─────────────────────────────┐  │
              │  3. Direct shell verification│◄─┘
              │     (the real truth)         │
              └─────────────────────────────┘
```

### Recipe

1. **Pick a deterministic task.** File contents, counts, code patterns — anything where a correct answer can be independently verified. Avoid web content (results vary by time) or creative tasks (no ground truth).

2. **Launch CORTEX + sub-agent in the SAME message** so they run concurrently. Example parallel dispatch:
   ```
   Bash: cortex --new --quiet -m grok-4-1-fast-reasoning "TASK"
   Agent: subagent_type=general-purpose, model=sonnet, prompt="TASK (identical wording)"
   ```

3. **Ground-truth via direct commands** after both return. CRITICAL: cross-reference every field the agents mention. A Python check on `dependencies` alone will miss `devDependencies` — verify your ground-truth command is as thorough as the broadest agent claim.

4. **Tally in a comparison table** — name, answer, correct/wrong, notable reasoning. Flag disagreements. Different models fail differently:
   - **Haiku** — scan-and-match shortcuts, count inconsistencies
   - **Sonnet** — sophisticated-but-creative interpretations that may violate literal constraints
   - **Opus** — slower, usually more precise, but not infallible
   - **CORTEX with XAI** — literal structural answers, very good at deterministic file tasks

5. **If three-way agreement**: ship. **If disagreement**: the pattern has surfaced a real issue — either in the code under test, in an agent's reasoning, or in your own ground-truth command. Investigate all three causes.

### Performance benchmarking (when comparing models / measuring harness cost)

Correctness benchmarking (above) asks *"is the answer right?"*. Performance benchmarking asks *"at what cost, how fast, how many round-trips?"* — used when comparing providers (e.g. "can DeepSeek v4 Flash match Opus on this task at lower cost?") or measuring a harness change (caching, compaction, loop-control).

**Capture these fields from every `/v1/messages` response — not just the text:**

| Field | Why it matters |
|---|---|
| `usage.inputTokens` / `usage.outputTokens` | Raw size; reveals system-message + history overhead |
| `usage.cacheReadTokens` / `usage.cacheCreationTokens` | Cache effectiveness. Cross-turn cache hit-rate is the headline metric for caching work |
| `usage.cost_in_usd_ticks` | Authoritative cost **only on the XAI Responses API path** — NOT present on `/v1/messages`. Don't claim "cheaper" from a path that doesn't emit it (this is an unfalsifiable trap — see memory) |
| `metadata.toolCallIterations` | Tool round-trips. A model that's "right" in 9 iterations is worse than one right in 3 |
| wall-clock (time the curl) | Latency. Measure with `time` or capture start/end timestamps |

**Discipline specific to performance runs:**

- **Same prompt, same session-shape, fresh server, one model at a time.** Restart the server between models — a warm prompt cache from model A inflates model B's apparent cache hit-rate.
- **n ≥ 2 different real-work tasks** (cardinal rule 1 applies doubly here — perf numbers from one task generalise to nothing).
- **Always run the gold in parallel.** An Opus sub-agent on the identical task is the quality bar. A cheap model that's 10× cheaper but wrong is not a win — tally cost *and* correctness in the same table, never cost alone.
- **Confound check is mandatory** (cardinal rule 4). A throttled run shows fake-slow latency and fake-low throughput. Grep the log, discard, re-run.
- **Tally format:** one row per (model × task): `model | task | correct? | inTok | outTok | cacheHit% | iters | wall-s | $ (if Responses path)`. Decisions come from the *table*, never from a single cell.

### Verifying specific code paths via debug log markers

After running a test, grep `/tmp/cortex-server.log` for the markers that prove the intended code path ran:

| Path being tested | Markers to confirm | Location |
|---|---|---|
| XAI Responses API | `[Orchestrator] API Pattern: responses` | `CortexOrchestrator.ts` |
| Server-side tool injection | `[Orchestrator Phase 2.3] Injected 3 server-side tools: web_search, x_search, code_execution` | `CortexOrchestrator.ts` |
| Hybrid tool detection | `[ServerSideToolDetection] Hybrid mode: N server-side + M client-side tools for xai` | `ServerSideToolDetection.ts` |
| Responses API response chaining | `[Orchestrator] Responses API response ID tracked: <uuid>` | `CortexOrchestrator.ts` |
| `previous_response_id` sent on continuation | `"previous_response_id": "<uuid>"`, `"has_previous_response_id": true` | `APIClient.ts` |
| Stateful-chain thinking preservation | `[Orchestrator Context] Skipping thinking block stripping — stateful Responses API with previous_response_id chaining` | `CortexOrchestrator.ts` |
| XAI `instructions` skip | `"has_instructions": false` (for XAI requests) | `APIClient.ts` |
| Messages API fallback | `[Orchestrator] API Pattern: messages` | `CortexOrchestrator.ts` |
| Server-side tool completion | `[Orchestrator] Server-side metadata extracted: YES`, `autonomousExecution: true` | `CortexOrchestrator.ts` |
| Reasoning pattern optimization | `[Orchestrator Context] Reasoning optimization: stripped old thinking blocks, saved N tokens` | `CortexOrchestrator.ts` |
| Helper model compaction | `[HelperMiddleware] Compacting context via <helper-model-id>` | `HelperModelMiddleware.ts` |
| Prompt caching hit | `[Orchestrator Cache] Cache hit detected: { ... hitRate: 'N%' }` | `CortexOrchestrator.ts` |
| Mentorship trigger | `[Orchestrator Mentorship] Detected keyword: <keyword>` or `Triggering periodic review` | `CortexOrchestrator.ts` |
| Loop detection | `[Orchestrator] Loop detected: tool <name> called N times` | `CortexOrchestrator.ts` |
| Orphaned tool_use recovery | `[Orchestrator] Recovered orphaned tool_use: <id>` | `CortexOrchestrator.ts` |

Good grep patterns for verifying a run:
```bash
grep -nE "API Pattern|response ID tracked|previous_response_id|has_instructions|server-side|Server-side|[Ee]rror" /tmp/cortex-server.log | head -40
```

### Known gotchas

- **`.env` alone won't test Responses API.** `ENABLE_SERVER_SIDE_TOOLS=true` must be set at server launch. It's NOT in the default `.env`. Without it, XAI requests go through Messages API even with tools.
- **`pkill -f "packages/server/dist/index.js"` is WRONG and fails silently.** A launcher that `cd`s into packages/server runs argv `node dist/index.js` (relative path) — that pattern never matches it, the old server survives, and the "new" one loses the port race. You then benchmark the *stale* server without knowing. Use `pkill -9 -f "node dist/index.js"` and ALWAYS verify with `ps -eo pid,args | grep "[d]ist/index.js"` (must be empty). Tell that you're hitting a zombie: the same `conversationId` survives a "restart" (impossible for a fresh process).
- **Benchmarking REQUIRES `CORTEX_MODE=stateless` at server launch.** The default is *persistent*: every `/v1/messages` request is appended as the next turn of ONE shared, monotonically-growing session (input balloons run-over-run, cache-hit rates are fake, a later answer can leak from an earlier one). The `/v1/messages` route has no per-request "new session" param in persistent mode, so the only lever is the launch env var. Stateless = fresh ephemeral orchestrator + session per request (server-side equivalent of `cortex --new`). Verify isolation before trusting any number: fire two identical tiny probes — different `conversationId` + identical `inputTokens` = isolated. (`/clear` is NOT equivalent and is CLI-only: it wipes messages but keeps the conversationId → the provider prompt-cache key stays warm → cross-iteration cache bleed survives it.)
- **Telemetry caveat.** `usage.outputTokens` is under-reported for Gemini (generateContent) and xAI on `/v1/messages`; Gemini's path surfaces no cache metrics (cacheHitRate 0). `usage.inputTokens` is the reliable cross-provider cost proxy. `usage.cost_in_usd_ticks` only exists on the XAI Responses path. Fresh-session floor ≈ 16k input tokens (system messages + tool schemas) — every isolated request pays this; subtract it when reasoning about task-specific cost.
- **Server boot is ~20s on a cold start, not 5s.** Poll `/health` in a loop; never fixed-sleep-5 then assume up.
- **Sessions are stateful (the root cause of the two bullets above).** Use `--new` (CLI) or `CORTEX_MODE=stateless` (HTTP) for benchmark runs, otherwise context leaks between tests and corrupts comparisons.
- **On resource-constrained hosts, prefer `npm run build` + `tsc --noEmit` over the full `vitest` suite** for quick validation — the watch-mode test runner can be heavy in small containers/sandboxes.
- **Debug logs are overwritten on each server restart.** Rename or copy `/tmp/cortex-server.log` before restarting if you need to compare across runs.
- **Ground-truth commands must be as thorough as the agents.** A `jq '.dependencies | keys'` that ignores `devDependencies` will make agents look wrong when they're right. Always re-check your ground-truth query against whatever fields the agents referenced.

### Example benchmark run

```bash
# 1. Start clean — correct kill pattern, stateless for isolation, setsid to
#    survive tool-call teardown, poll (don't fixed-sleep) for the ~20s boot.
pkill -9 -f "node dist/index.js" 2>/dev/null; sleep 2
ps -eo pid,args | grep "[d]ist/index.js" && echo "ZOMBIE — kill -9" || echo "clean"
cd <repo-root>/packages/server && \
  DEBUG=true ENABLE_SERVER_SIDE_TOOLS=true CORTEX_MODE=stateless \
  setsid nohup node dist/index.js > /tmp/cortex-server.log 2>&1 < /dev/null &
for i in $(seq 1 30); do sleep 2; curl -sf http://localhost:4000/health >/dev/null && break; done
# isolation sanity-check: 2 identical probes must give DIFFERENT conversationId,
# SAME inputTokens. If conversationId repeats or inputTokens grows → not isolated.
curl -s http://localhost:4000/health | head -c 80

# 2. Same prompt, parallel dispatch (do this in ONE tool-call message):
#    Bash:  cortex --new --quiet -m grok-4-1-fast-reasoning "Read A and B, report X, Y, Z"
#    Agent: subagent_type=general-purpose, model=sonnet, prompt="Read A and B, report X, Y, Z"

# 3. Ground truth (example for package.json analysis)
python3 -c "import json; d=json.load(open('A/package.json')); print('runtime:', d.get('dependencies',{})); print('dev:', d.get('devDependencies',{}))"
python3 -c "import json; d=json.load(open('B/package.json')); print('runtime:', d.get('dependencies',{})); print('dev:', d.get('devDependencies',{}))"

# 4. Verify code path hit the marker you expected
grep -nE "API Pattern|response ID tracked|previous_response_id" /tmp/cortex-server.log | head -20

# 5. Tally all three in a comparison table. Ship if three-way agreement, investigate if not.
```

## Headless Command Systems

Two `/command` systems work in headless mode. The 70+ interactive CLI commands (`/model`, `/session`, `/debug`, `/theme`, etc.) are CLI-only and do NOT work headlessly.

### System 1: SlashCommand Tool (`.cortex/commands/`)

The model calls the `SlashCommand` tool with `{command: "/name arg1 arg2"}`. The executor loads `.cortex/commands/name.md`, substitutes `$1`/`$2` with args, and returns the expanded body as tool output. The model then follows the instructions.

**File format:**
```markdown
---
description: What this command does
argument-hint: [arg1] [arg2]
---

Body with $1 and $2 placeholders.
Unused placeholders ($3, $99) are stripped.
```

**Location:** `<repo-root>/.cortex/commands/`
**Executor:** `packages/executors/src/implementations/extensions/SlashCommandTool.ts`
**Name from:** filename without `.md` extension (e.g., `review.md` → `/review`)
**Subdirectories:** supported — `deployment/deploy-prod.md` → `/deploy-prod`
**Cache:** in-memory, cleared on server restart

**Installed commands:**
| Command | Args | Purpose |
|---------|------|---------|
| `/review` | `[path]` | Code review with actionable feedback |
| `/test` | `[package-path]` | Run tests and report results |
| `/diff` | `[path]` | Analyze uncommitted git changes |
| `/deps` | `[path]` | Dependency and import analysis |
| `/find-bug` | `[error-or-symptom]` | Root cause investigation |
| `/explain` | `[path-or-function]` | End-to-end code explanation |
| `/profile` | `[task]` | Token/iteration performance metrics |
| `/compare` | `[path-a] [path-b]` | Side-by-side comparison |
| `/search` | `[term]` | Deep codebase search |

**To create a new command:** Write a `.md` file to `.cortex/commands/` with the frontmatter format above. Available immediately (cache clears on next server restart, or invoke any unknown command to trigger reload).

### System 2: Skill Tool (`.agents/skills/`)

The model calls the `Skill` tool with `{skill: "name"}`. Skills are YAML-frontmatter markdown files that provide knowledge and instructions, not argument-substituted templates.

**File format:**
```markdown
---
name: skill-name
description: What this skill provides
triggers:
  - keyword1
  - keyword2
---

# Knowledge content, instructions, patterns, reference material
```

**Locations searched:**
- `.agents/skills/*/SKILL.md` (project)
- `.claude/skills/*/SKILL.md` (symlinks)
- `~/.claude/skills/*/SKILL.md` (global)

**Key difference from SlashCommand:** Skills provide context/knowledge injected into the conversation. SlashCommands are task templates with argument substitution that produce tool output.

**To create a new skill:** Create `.agents/skills/name/SKILL.md` with frontmatter, then symlink from `.claude/skills/name` → `../../.agents/skills/name`.
