# Changelog

All notable changes to Nexus Cortex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- **Full feature-set documentation audit.** Corrected the headline numbers to match the
  code — **45 built-in tools** (was "17+"), **86 models across 11 providers** (was "65+ /
  10"), and replaced stale model names (Claude 3 Opus, GPT-4 Turbo, Grok 2, …) with the
  current registry. Documented the previously-undocumented headline capabilities:
  sandboxed artifacts + React introspection, sub-agents (`Task`), auto-research
  (`cortex autoresearch`), the permission system, model router, mentorship, the git/PR
  tools, and the structured `cortex <group>` command set. Fixed broken README links.
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

- **Multi-provider orchestration** — 86 models across 11 providers: Anthropic,
  OpenAI, Google (Gemini / Vertex + Gemma), xAI, Cloudflare Workers AI, DeepSeek,
  Zhipu/GLM, Qwen/DashScope, Moonshot, MiniMax, and Mercury (Inception) — via a
  pluggable adapter layer (Messages, Chat Completions, GenerateContent, GenAI,
  Responses).
- **Built-in tool suite (45 tools)** — file operations, search (glob/grep), web
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
