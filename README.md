<p align="center">
  <img src="docs/assets/nexus-cortex-hero.svg" alt="Nexus Cortex — headless multi-provider AI agent harness" width="688">
</p>

# Nexus Cortex

> **A headless, multi-provider AI agent harness — embed it as a library, script it from the CLI, or run it as a stateful agent server.**

[![npm](https://img.shields.io/npm/v/@nexus-cortex/cli)](https://www.npmjs.com/package/@nexus-cortex/cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-green)](https://nodejs.org)

Nexus Cortex is the engine *underneath* the agent — not another interactive terminal app, but the harness you build on. One orchestrator drives many models across many providers through a pluggable adapter layer, with sub-agents, MCP, sandboxed artifacts, a permission engine, context management, and append-only session history built in.

Run it three ways: **as a library** (`import { CortexOrchestrator }`), **as a headless CLI** (`cortex "…"`), or **as a stateful HTTP agent server**.

> **Release 1 is the headless harness** — `core`, `executors`, `server`, `cli`. The interactive React/Ink terminal UIs (`@nexus-cortex/tui`) land in Release 2.

## Quick Start

```bash
npm install -g nexus-cortex
cortex                       # first run sets up your API key, then drops you into chat
```

The first time you run `cortex`, an interactive setup asks which provider you use, takes your API key, and picks a default model — saved to `~/.cortex/.env` (so it works from any folder). Re-run it any time with `cortex config init`.

Then you're in **interactive chat** — just type, no shell quoting to worry about. The server auto-starts and the session persists across messages:

```text
cortex> what is this project?
cortex> now summarize the largest file
```
Type `exit` (or Ctrl-D) to leave.

Prefer one-shot or scripting? Pass the message as an argument (quote it so the shell doesn't eat `?`/`*`), or run the autonomous agent:

```bash
cortex "What is this project?"                                            # one-shot
cortex agent --cwd ./my-project "add a --version flag and run the tests"  # autonomous (alias: cortex run)
```

**Staying current:** when a new release is out you'll see a one-line notice — update with `cortex --update`. Remove it with `cortex --uninstall`.

> Prefer environment variables? Export a key instead of the wizard: `export ANTHROPIC_API_KEY=sk-ant-…` and `export DEFAULT_MODEL_ID=claude-sonnet-4-6`. Claude also works with a Claude.ai Pro/Max OAuth subscription instead of an API key — see [docs/authentication.md](docs/authentication.md).

## Why Nexus Cortex

- **Every major provider, one harness.** The five major labs — **Anthropic, OpenAI, Google/Gemini, xAI, and DeepSeek** — are proven end-to-end. A dozen more (Cloudflare Workers AI, Zhipu/GLM, Qwen, Moonshot/Kimi, MiniMax, Mercury) are wired through the same adapter layer. <!--AUTO-COUNT:models-->84<!--/AUTO-COUNT--> models across <!--AUTO-COUNT:providers-->11<!--/AUTO-COUNT--> providers in all — switch mid-session, route from benchmark history, or mix providers across sub-agents. Run `cortex models list` for the live set.
- **Headless and scriptable by design.** No UI required. Pipe JSON, resume sessions by ID, and chain multi-turn agent workflows — the server is a *stateful agent*, not a stateless endpoint.
- **An embeddable engine, not a closed app.** The orchestrator, adapters, <!--AUTO-COUNT:tools-->45<!--/AUTO-COUNT--> built-in tools, and middleware are a clean TypeScript library you build on.
- **A real harness, batteries included.** Parallel sub-agents (`Task`) with per-agent permissions, MCP tool integration, a sandboxed-artifact toolset (run + inspect real web apps), git/PR tooling, a policy-based permission engine, token-budget + prompt-cache context management, and append-only JSONL sessions with file checkpoints.
- **A built-in improvement loop (opt-in).** Build a baseline and a candidate, benchmark both on a graded task set, and gate a keep/discard decision with real statistics — driving the harness's own self-improvement (inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch)).

## Documentation

| Doc | What's in it |
|-----|--------------|
| **[User Guide](docs/user-guide.md)** | The `cortex` CLI in full, running the HTTP server, the REST API, sessions, PR review, production deployment, troubleshooting |
| **[Architecture](docs/architecture.md)** | Monorepo layout, the orchestrator, providers, tools, sub-agents, auto-research, and the other core systems |
| **[Authentication](docs/authentication.md)** | Provider API keys and Claude OAuth setup |
| **[Configuration](docs/configuration.md)** | Every environment variable, annotated |
| **[Embed the library](docs/user-guide.md#install)** | Use `@nexus-cortex/core` directly in your own code |
| **[Changelog](CHANGELOG.md)** | Release history |

## Contributing

Contributions welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 Spitfire-Products.

Built clean-room as a multi-provider TypeScript agent harness.
