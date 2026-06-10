# Configuration reference

Every Nexus Cortex setting is an environment variable, read from `.env` (or the process environment) at startup.

> **Canonical sources:** [`.env.example`](../.env.example) is the annotated template, and `packages/core/src/config/SettingsSchema.ts` is the schema (defaults + valid choices). This page mirrors them for browsing — if anything here disagrees, those win.

Per-launch overrides win — e.g. `DEFAULT_MODEL_ID=grok-4.3 PORT=4100 node packages/server/dist/index.js`. Booleans are the literal strings `true`/`false`. Only API keys are required; every other variable has a proven-optimal default.

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
| `NVIDIA_API_KEY` | — | Reserved for NVIDIA-hosted models (no standalone NVIDIA cards are registered yet; NVIDIA models are currently reached via Cloudflare). |
| `INCEPTION_API_KEY` | — | Inception Labs Mercury diffusion models (`mercury-2`). |
| `CLOUDFLARE_API_TOKEN` | — | Cloudflare Workers AI (`@cf/*` models). Requires `CLOUDFLARE_ACCOUNT_ID`. |
| `CLOUDFLARE_ACCOUNT_ID` | — | Cloudflare account ID (paired with the token above). |
| `DASHSCOPE_API_KEY` | — | Alibaba Qwen (DashScope) — `qwen-*` models. |
| `MINIMAX_API_KEY` | — | MiniMax — `minimax-*` models. |
| `MOONSHOT_API_KEY` | — | Moonshot AI (Kimi) — `moonshot-*` / `kimi-*` models. |
| `ZHIPU_API_KEY` | — | Zhipu AI (GLM) — `glm-*` models. |
| `HUGGINGFACE_API_KEY` | — | Reserved for Hugging Face Inference (`HUGGINGFACE_TOKEN` also accepted; cards exist but are not registered in the default build yet). |
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
