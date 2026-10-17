# Authentication & API Keys

The fastest path is the first-run wizard:

```bash
cortex setup
```

It asks which providers you intend to use, takes their keys, lets you pick the action / helper / mentor models and the web-tools
backend, writes `~/.cortex/.env`, and verifies each model with one tiny request. Running `cortex` in a terminal with no key found
starts the same wizard.

Without the wizard, you need **one** provider key, set any of these ways:

```bash
cortex config set DEEPSEEK_API_KEY sk-...     # writes ~/.cortex/.env
#   …or open ~/.cortex/.env (created on first run, keys-only, every supported key listed blank) and fill one in
export DEEPSEEK_API_KEY=sk-...                # …or inject it: the environment always wins over the files
```

**Where a key is read from, highest precedence first:** the process environment → `./.env` in the current directory → the
package's own `.env` (source checkouts) → `~/.cortex/.env` → the shipped defaults. A `.env.local` beside any of those overrides
everything. `~/.cortex/.env` ships with every key **blank**, so a secret injected by a container or secrets store is never
overwritten and nothing needs to be written to disk. If you run `cortex` with no key anywhere and no terminal (a script), it
creates `~/.cortex/.env`, prints what to add, and stops without starting a server.

## Provider API keys

Set the variables for the providers you use (`cortex config get` shows every setting and where it came from; `cortex setup` lists the providers):

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Claude (Anthropic) |
| `OPENAI_API_KEY` | OpenAI (GPT / o-series) |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Google Gemini |
| `XAI_API_KEY` | xAI (Grok) |
| `DEEPSEEK_API_KEY` | DeepSeek |

Other providers (Cloudflare Workers AI, Zhipu/GLM, Qwen, Moonshot/Kimi, MiniMax, Mercury)
use the same pattern. Run `cortex models list` for the live set.

## Claude: API key *or* OAuth

Claude works two ways — pick one:

- **API key** — set `ANTHROPIC_API_KEY=sk-ant-…` in `.env`. Done.
- **OAuth** — use a Claude.ai Pro/Max subscription instead of a metered API key (below).

You can pin the method with `ANTHROPIC_AUTH_METHOD=auto|oauth|api-key` (default `auto`).
The resolution order under `auto` is:

```
~/.claude/.credentials.json  →  CLAUDE_CODE_OAUTH_TOKEN  →  ANTHROPIC_API_KEY
```

### Claude OAuth setup

There are two ways to provide the OAuth token; the harness checks them in this order.

**1. `~/.claude/.credentials.json` (preferred)**

This file is created automatically when you sign in with the Claude Code CLI:

```bash
claude login
```

If you've already done that, the harness reads it as-is — nothing else to do. It lives in
your home directory (not the project), is written owner-only (`chmod 600`), and includes a
refresh token so it renews itself.

To create it by hand instead:

```bash
mkdir -p ~/.claude && chmod 700 ~/.claude
cat > ~/.claude/.credentials.json <<'JSON'
{ "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-…",
    "refreshToken": "sk-ant-ort01-…",
    "expiresAt": 1765400000000,
    "scopes": ["user:inference"] } }
JSON
chmod 600 ~/.claude/.credentials.json
```

**2. `CLAUDE_CODE_OAUTH_TOKEN` (headless / CI)**

Set a bare token in `.env` (or the environment) — handy where there's no `claude login`:

```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…
```

The OAuth token is **never** written to any project file — keep it in the home-directory
credentials file or in `.env`, both of which stay outside version control.
