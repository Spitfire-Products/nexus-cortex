# Changelog

All notable changes to Nexus Cortex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.14.0] - 2026-06-11

### Added

- **`cortex autoresearch experiment` runs on any project, not just the cortex harness.**
  An `ExperimentTarget` seam lets `--run-cmd`/`--build-cmd`/`--accept-exit` grade a shell
  command per arm instead of building+serving a cortex server, so a library, CLI, test
  suite, or backtest gets the same base-vs-candidate statistical gate. Off-git arm dirs
  fall back to a basename label.
- **`cortex autoresearch loop` — the autonomous loop.** Fix → measure base-vs-candidate →
  keep only what verifies → advance the base → repeat, until a success metric, max rounds,
  or a dry backlog. Each round runs in a throwaway worktree off a dedicated `autoresearch/loop-*`
  branch, so **your branch and working tree are never touched** (accepted commits are anchored
  to the loop branch; merge it when satisfied). `--fixer-cmd` plugs any transformer in place of
  the LLM Fixer; `--holdout-set` gates merges on out-of-sample verification (without it, merges
  are train-only and flagged unverified); `--success-metric <taskId:threshold>` stops early.

---

## [4.13.0] - 2026-06-11

### Added

- **Auto-research can now measure any project, not just the cortex harness.**
  `cortex autoresearch bench` gained `--run-cmd <template>` (plus `--build-cmd`, `--cwd`,
  `--accept-exit`) to grade a **shell command** per task instead of a cortex server — so a
  library, CLI, test suite, or backtest runs through the same statistically-gated bench.
  The command's stdout is graded by the task's verifier; a non-accepted exit code fails the
  task (and seeds the backlog).
- **Numeric verifier** for task sets: `{ "type": "numeric", "direction": "maximize" | "minimize",
  "extract"?, "best"?, "worst"?, "target"? }`. Extracts a number from the output (a custom
  regex capture group, or the last number by default) and scores it continuously, so any
  metric — ROI, latency, accuracy, tour length — can drive keep/discard. `target` sets the
  pass threshold; `best`/`worst` map the value to 0–100.
- **Deterministic backlog seeding.** A failing benchmark verifier now auto-records a
  deficiency in `.cortex/research-backlog.jsonl` (idempotent per task, confidence scaled by
  how consistently it failed), so a failure is captured even when nothing thought to log it.
  `--no-seed-backlog` opts out; the holdout split never seeds.

---

## [4.12.0] - 2026-06-10

### Added

- **`cortex agent` (alias `cortex run`).** A one-shot, autonomous headless agent: point it at a
  task and a working directory, and it runs to completion and exits. Because a headless run has
  no interactive approver, it auto-approves tool actions by default. Supports `--cwd`, `--model`,
  and `--json` (machine-readable result) — the building block for running Cortex as a callable
  agent in CI or a container.

### Changed

- **DeepSeek lineup trimmed to V4.** Removed `deepseek-chat` and `deepseek-reasoner` — DeepSeek
  retires both on 2026-07-24. `deepseek-v4-flash` supersedes chat and `deepseek-v4-pro` supersedes
  reasoner; the old names now resolve to those successors, so existing model selections keep
  working. The default helper model is now `deepseek-v4-flash`.
- **Public README reframed** around what Cortex is — a headless, multi-provider agent harness:
  added a peer-harness comparison, provider maturity tiers (which providers are proven end-to-end
  vs. preview), and a tour of the advanced tooling surfaces. The full environment-variable
  reference moved to `docs/configuration.md`.
- **`GIT_ALLOWED_REPOS` no longer warns on startup.** When unset (all repos permitted) the git/PR
  tools used to print a warning on every launch; that is gone. The trade-off and how to restrict
  access are documented in `.env.example`.

### Fixed

- **`cortex` one-shot commands no longer hang.** When a one-shot invocation auto-starts a
  background server, the client now detaches that server's stdio pipes once it is healthy, so the
  command exits cleanly instead of blocking on the open pipe.

---

## [4.11.0] - 2026-06-10

### Added

- **Project agents discoverable from any directory.** Agents shipped with the install
  (under `$CORTEX_ROOT/.cortex/agents`) now load no matter where you launch from, and the
  `project` tier walks up from the current directory to the nearest `.cortex/agents` — so a
  project's agents resolve even when you start the tool from a subdirectory.
- **Agent scope marker.** Listing agents (`Task` with `subagent_type: "list"`) now shows a
  `Scope` column marking which agents are specific to the current project (`*`) versus
  personal (`~/.cortex`) or shipped builtins.

### Fixed

- **CLI introspection commands repaired.** `cortex tools list` (was reporting zero tools),
  `tools info`, `models list` / `info` / `switch`, `mcp list`, and `cache metrics` now
  return correct data and exit cleanly instead of hanging on open MCP connections.
  (`models info` also no longer crashes on a field-name mismatch.)
- **`cortex permissions` works headless.** `grant`, `revoke`, `policies`, `tools`, `mode`,
  `set`, and `auto-approve` now read and write the active permission profile file directly
  — persisting across runs — instead of failing with "fetch failed" when no server is
  running. Grants/revokes target the project-level profile only, never your global
  `~/.cortex` one. Honors `PERMISSION_PROFILE` (default `dev`).
- **Browse sub-agent uses the real browser tools.** The headless `browse` agent's tool
  whitelist is now enforced, so it can no longer fall back to `WebFetch`/`WebSearch` and
  drives the nexus-browser MCP tools as intended.
- **nexus-browser MCP no longer floods the terminal UI.** Transient SSE stream drops are
  handled quietly (the client auto-reconnects), and an HTTP keep-alive setting prevents the
  idle stream from being terminated every few minutes — so the TUI is no longer spammed
  with `SSE stream disconnected` errors.

---

## [4.10.0] - 2026-06-10

### Added

- **Claude Fable 5 model** (`claude-fable-5`) — Anthropic's top-tier model, registered
  across the Anthropic provider with adaptive-thinking support (1M context, 128K output).

### Changed

- **Hardened the git/PR & worktree tools.** `PRAgent` and `WorkspaceManager` now shell
  out without a shell (`execFile` with argument arrays) and validate every repo/branch/PR
  input, closing shell- and argument-injection vectors. A new opt-in allow-list governs
  what they can touch — `GIT_ALLOWED_REPOS`, `GIT_ALLOWED_ACTIONS`, `GIT_AUTH_TOKEN`
  (kept in the subprocess env, never on argv or in a URL), and `GIT_HOST` (GitHub
  Enterprise). The `/v1/pr/webhook` endpoint now verifies GitHub's `X-Hub-Signature-256`
  HMAC (`GITHUB_WEBHOOK_SECRET`) and is disabled unless a secret is set.
- **Cleaner worktree lifecycle** — `cleanup` removes the worktree, the branch it created,
  and (for clones) the clone directory; uses the OS temp dir; surfaces real subprocess
  errors; honors cancellation.

### Fixed

- **EndTurn no longer rejects valid attestations.** The end-of-turn audit tool stopped
  looping on well-formed input that omitted optional evidence arrays, and it's no longer
  surfaced to the model when its gate is disabled.

### Security

- **`.env` is now gitignored** so your API keys and `CLAUDE_CODE_OAUTH_TOKEN` are never
  committed. Copy `.env.example` to `.env` to configure.
- **`.cortex/config.json` (UI preferences) can never hold a secret** — a save-time guard
  strips any secret-looking key before writing this tracked file.

### Documentation

- **Full feature-set documentation audit.** Removed stale model names (Claude 3 Opus,
  GPT-4 Turbo, Grok 2, …) in favor of the current registry, and documented the
  previously-undocumented headline capabilities: sandboxed artifacts + React
  introspection, sub-agents (`Task`), auto-research (`cortex autoresearch`), the
  permission system, model router, mentorship, the git/PR tools, and the structured
  `cortex <group>` command set. Fixed broken README links.
- **Auto-updating doc counts.** The README's tool / model / provider / slash-command
  counts are generated from the live registries (`scripts/update-doc-counts.mjs`) rather
  than hardcoded — refreshed on every build and enforced in CI, so they can never silently
  drift. Run `npm run docs:counts` to refresh manually.
- **Complete environment-variable reference** in the README — every supported variable,
  its default, and how to use it.
- **Claude credential guide** — where to put the OAuth token
  (`~/.claude/.credentials.json` via `claude login`, or `CLAUDE_CODE_OAUTH_TOKEN`), the
  resolution order, and the `ANTHROPIC_AUTH_METHOD` switch.

---

## [4.9.0] - 2026-06-10

Initial public release of the Nexus Cortex monorepo (Release 1: the engine).

### Packages

- `@nexus-cortex/types` — shared TypeScript interfaces (zero runtime deps)
- `@nexus-cortex/core` — orchestration engine, adapters, middleware, sessions, models, MCP
- `@nexus-cortex/executors` — built-in tool implementations
- `@nexus-cortex/server` — optional Express HTTP server
- `@nexus-cortex/cli` — headless command-line interface (`cortex`)
- `@nexus-cortex/tui` — React/Ink terminal UI (deferred to Release 2; not in this release)

### Features

- **Multi-provider orchestration** across Anthropic, OpenAI, Google (Gemini /
  Vertex + Gemma), xAI, Cloudflare Workers AI, DeepSeek, Zhipu/GLM, Qwen/DashScope,
  Moonshot, MiniMax, and Mercury (Inception) — via a pluggable adapter layer
  (Messages, Chat Completions, GenerateContent, GenAI, Responses).
- **Built-in tool suite** — file operations, search (glob/grep), web
  fetch/search, shell execution, sub-agent dispatch, conversation-history tools,
  and sandboxed artifacts, with a dual registry (immutable base tools + dynamic
  addon tools).
- **Sandboxed artifacts with visual feedback** — `create_artifact_tool` spins up
  persistent web/server artifacts (tmux-managed) with screenshots, DOM, console,
  network, and accessibility snapshots the model can iterate against
  (`inspect_sandbox`, `interact_with_sandbox`, `modify_sandbox` with hot reload).
- **React artifacts** — `framework: "react"` builds a React app from a single
  component (no hand-written HTML): zero-install CDN mode, or an esbuild-bundled
  mode with real source maps and automatic re-bundling on edit. React and esbuild
  ship as optional dependencies; CDN mode needs nothing.
- **React introspection senses** — `sandbox_detect_framework`, `sandbox_scan`
  (elements with stable `cssSelector`, `componentName` on React pages),
  `sandbox_grab` (DOM detail + `react: { componentName, componentStack, props,
  sourceLocation }` — source-mapped to real `src/*.tsx` lines in bundled mode),
  `sandbox_component_tree` (fiber hierarchy), and `sandbox_render_trace`
  (per-component re-render counts/timings across interactions). The scan → act →
  scan loop and element contracts mirror common browser-automation MCP tools, so
  skills transfer between surfaces.
- **MCP integration** — connect Model Context Protocol servers and optionally
  auto-inject their tools.
- **Context management** — token-budget tracking, helper-model compaction, and
  prompt caching, with sliding-window or priority-based strategies.
- **Session persistence** — append-only JSONL history with UUID message IDs and
  content-addressable file checkpoints.
- **Permission system** — dev/test/prod profiles with whitelist, blacklist,
  file-operation, and command policies.
- **Git/PR access control** — the PR-review and worktree tools shell out via
  `execFile` (no shell) with validated inputs, and honor an opt-in allow-list:
  `GIT_ALLOWED_REPOS`, `GIT_ALLOWED_ACTIONS`, `GIT_AUTH_TOKEN` (env-only, never on
  argv/URL), and `GIT_HOST` (GitHub Enterprise). The `/v1/pr/webhook` endpoint
  verifies GitHub's `X-Hub-Signature-256` HMAC (`GITHUB_WEBHOOK_SECRET`) and is
  disabled unless a secret is set.
- **System messages** — auto-loaded project context (`CORTEX.md`) and custom
  hot-reloaded system prompts.
- **Optional model router** — task-aware model selection from recorded
  performance history (off by default), with a multi-entry exclude list
  (`MODEL_ROUTER_EXCLUDE`, exact IDs or `prefix*` wildcards) honored by both
  greedy and exploration routing.
- **Server lifecycle controls** — inactivity auto-shutdown (`SERVER_IDLE_TIMEOUT`),
  graceful shutdown with connection draining (`SHUTDOWN_GRACE_MS`), session
  resume on boot (`AUTO_RESUME` / `RESUME_SESSION_ID`), and an opt-in
  sandbox/tmux dashboard (`ENABLE_DASHBOARD`, `DASHBOARD_PORT` — off by default;
  tmux/viewer tools lazily start it on demand regardless).
- **Interfaces** — headless `cortex` CLI for scripting and an optional HTTP
  server exposing the orchestrator over REST/SSE. Interactive terminal UIs
  arrive in Release 2.

### Configuration

- All settings are documented in `.env.example`; provider API keys are read from
  the environment. See `README.md` for configuration beyond environment variables
  (agents, commands, MCP servers, and permissions live under `.cortex/`).

### License

- Apache-2.0 (explicit patent grant; `NOTICE` ships with every package).
