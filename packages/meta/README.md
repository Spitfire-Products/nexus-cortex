# nexus-cortex

A headless, multi-provider AI agent harness — the one-command install.

```bash
npm install -g nexus-cortex
```

This installs the `cortex` CLI and HTTP server (`@nexus-cortex/cli` + `@nexus-cortex/server`). Then:

```bash
cortex "What is this project?"        # the server auto-starts on first use
cortex agent --cwd ./proj "<task>"    # one-shot autonomous agent
```

Add at least one provider key first — rename `.env.example` to `.env` and set e.g. `ANTHROPIC_API_KEY`.

Full docs, the REST API, and the embeddable library packages (`@nexus-cortex/core`, `@nexus-cortex/executors`) are in the [main repository](https://github.com/Spitfire-Products/nexus-cortex).

Apache-2.0 © Spitfire-Products.

## First run

```bash
cortex setup
```

The wizard asks which providers you use, takes their API keys, lets you pick the action / helper / mentor models and the web-tools
backend, writes `~/.cortex/.env` and verifies each model with one request. Running `cortex` with no key in a terminal starts it for you.
The shipped defaults run every role on `deepseek-flash` with the `standard` lever profile (the harness's proven steering and
failure-path levers). Full docs: https://github.com/Spitfire-Products/nexus-cortex#readme
