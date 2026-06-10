# Changelog

All notable changes to Nexus Cortex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.8.0]

Initial public release of the Nexus Cortex monorepo.

### Packages

- `@nexus-cortex/types` — shared TypeScript interfaces (zero runtime deps)
- `@nexus-cortex/core` — orchestration engine, adapters, middleware, sessions, models, MCP
- `@nexus-cortex/executors` — built-in tool implementations
- `@nexus-cortex/server` — optional Express HTTP server
- `@nexus-cortex/cli` — headless command-line interface (`cortex`)
- `@nexus-cortex/tui` — React/Ink terminal UI (deferred to Release 2; not in this release)

### Features

- **Multi-provider orchestration** across Anthropic, OpenAI, Google (Gemini /
  Vertex), xAI, DeepSeek, and additional providers (Qwen/DashScope, MiniMax,
  Moonshot, Zhipu/GLM, Hugging Face, NVIDIA, Cloudflare, Inception) via a
  pluggable adapter layer (Messages, Chat Completions, GenerateContent, GenAI,
  Responses).
- **Built-in tool suite** — file operations, search (glob/grep), web fetch/search,
  shell execution, sub-agent dispatch, and conversation-history tools, with a
  dual registry (immutable base tools + dynamic addon tools).
- **MCP integration** — connect Model Context Protocol servers and optionally
  auto-inject their tools.
- **Context management** — token-budget tracking, helper-model compaction, and
  prompt caching, with sliding-window or priority-based strategies.
- **Session persistence** — append-only JSONL history with UUID message IDs and
  content-addressable file checkpoints.
- **Permission system** — dev/test/prod profiles with whitelist, blacklist,
  file-operation, and command policies.
- **System messages** — auto-loaded project context (`CORTEX.md`) and custom
  hot-reloaded system prompts.
- **Optional model router** — task-aware model selection from recorded
  performance history (off by default).
- **Interfaces** — headless `cortex` CLI for scripting, a React/Ink terminal UI,
  and an optional HTTP server exposing the orchestrator over REST/SSE.

### Configuration

- All settings are documented in `.env.example`; provider API keys are read from
  the environment. See `README.md` for configuration beyond environment variables
  (agents, commands, MCP servers, and permissions live under `.cortex/`).
