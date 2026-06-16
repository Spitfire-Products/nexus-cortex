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
```

That puts the `cortex` command on your PATH. Now give it **one provider key** — three ways, pick whichever fits:

```bash
# 1. Set a key in the global config file (created for you automatically)
cortex config set DEEPSEEK_API_KEY sk-...        # writes ~/.cortex/.env

# 2. …or open the file and edit it by hand
#    ~/.cortex/.env  — every supported key is listed, blank; fill one in.
#    (Run `cortex config init` to create it now without waiting for first run.)

# 3. …or export it / use your platform's secrets store — the environment wins over the file
export DEEPSEEK_API_KEY=sk-...
```

> **Keys are read from your environment first, then `~/.cortex/.env`.** The file ships with every key blank, so a value set in your environment (or a Cloudflare/Replit-style secrets store) always takes precedence — drop the file in a container and let secrets fill it. If you run `cortex` with no key found anywhere, it creates `~/.cortex/.env` for you, tells you exactly what to add, and stops — no half-started server to clean up.

Then just talk to it — **the server auto-starts on first use**, no separate step, and headless runs **auto-approve tools** (no approval prompts to babysit):

```bash
# Chat — multi-turn, the session persists across calls
cortex "What is this project?"
cortex "Now summarize the largest file"

# Browse the live web (zero-config — no setup, no API key of your own)
cortex "Open example.com and summarize the page"

# One-shot autonomous agent in any directory (alias: `cortex run`)
cortex agent --cwd ./my-project "add a --version flag to the CLI and run the tests"
```

> Claude also works with a Claude.ai Pro/Max OAuth subscription instead of an API key — see [docs/authentication.md](docs/authentication.md). For advanced `.env` setup, see [docs/configuration.md](docs/configuration.md).

## Everyday commands

| Task | Command |
|------|---------|
| Set a key | `cortex config set KEY value`  (or edit `~/.cortex/.env`) |
| Create the config file now | `cortex config init`  (`--force` refreshes the template, keeps your values) |
| Run a one-shot agent | `cortex agent "…"`  (auto-approves tools, fresh session, self-stops on idle) |
| Generate project context (`CORTEX.md`) | `cortex "generate a CORTEX.md for this project"`  (runs the init tool) |
| Add an MCP server | `cortex mcp init` then `cortex mcp enable <name>`  (the browser already works zero-config) |
| Stop the background server | `cortex --shutdown` |
| Update to the latest version | `cortex update` |
| Uninstall | `cortex uninstall`  (or `npm uninstall -g nexus-cortex`) |

The server the CLI auto-starts persists in the background and **self-stops after 60s idle**. To run a long-lived, interactive server yourself, use `cortex-server` — it stays up until you stop it, and (being a real terminal) prompts for tool approval there.

## Customize it — your agents, skills, and commands

Cortex ships a library of agents, skills, and commands. Browse the bundled set in `~/.cortex/builtin/` (a read-only reference that re-syncs to your installed version automatically). To add your **own**, drop files into the matching folder in your home dir — they load alongside (and override) the builtins:

```
~/.cortex/agents/           your agent profiles (.md with YAML front-matter)
~/.cortex/skills/           your skills
~/.cortex/commands/         your slash commands
~/.cortex/system-messages/  your custom system prompts
~/.cortex/builtin/          read-only copy of everything that ships — look here for examples
```

These folders are created for you on first run, each with a short README. Agent profiles should use `model: inherit` (the default) — the agent then runs on whatever model the orchestrator is using, and falls back gracefully if a pinned model's provider key isn't configured.

## Why Nexus Cortex

- **Every major provider, one harness.** The five major labs — **Anthropic, OpenAI, Google/Gemini, xAI, and DeepSeek** — are proven end-to-end. A dozen more (Cloudflare Workers AI, Zhipu/GLM, Qwen, Moonshot/Kimi, MiniMax, Mercury) are wired through the same adapter layer. <!--AUTO-COUNT:models-->84<!--/AUTO-COUNT--> models across <!--AUTO-COUNT:providers-->11<!--/AUTO-COUNT--> providers in all — switch mid-session, route from benchmark history, or mix providers across sub-agents. Run `cortex models list` for the live set.
- **Headless and scriptable by design.** No UI required. Pipe JSON, resume sessions by ID, and chain multi-turn agent workflows — the server is a *stateful agent*, not a stateless endpoint. Drop it in a container with secrets in the environment and it's a true one-shot: `npm i -g nexus-cortex` → `cortex "…"`.
- **An embeddable engine, not a closed app.** The orchestrator, adapters, <!--AUTO-COUNT:tools-->45<!--/AUTO-COUNT--> built-in tools, and middleware are a clean TypeScript library you build on.
- **A real harness, batteries included.** Parallel sub-agents (`Task`) with per-agent permissions, MCP tool integration (incl. a zero-config headless browser), a sandboxed-artifact toolset (run + inspect real web apps), git/PR tooling, a policy-based permission engine, token-budget + prompt-cache context management, and append-only JSONL sessions with file checkpoints.
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
