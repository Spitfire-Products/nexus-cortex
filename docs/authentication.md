# Authentication & API Keys

Nexus Cortex resolves a provider key from your **environment first**, then a `.env` file
(`./.env` in the current directory, then the global `~/.cortex/.env`). You only need **one**
provider key to start. Pick whichever fits:

```bash
# Set a key in the global config file (created for you automatically)
cortex config set DEEPSEEK_API_KEY sk-...     # writes ~/.cortex/.env

# …or open ~/.cortex/.env and fill in a key by hand
#   (run `cortex config init` to create it now; every supported key is listed, blank)

# …or export it / use your platform's secrets store — the environment wins over the file
export DEEPSEEK_API_KEY=sk-...
```

`~/.cortex/.env` ships with every key **blank**, so a value set in your environment (or a
secrets store like Cloudflare/Replit) always takes precedence — ideal for containers, where you
inject secrets and write nothing to disk. If you run `cortex` with no key found anywhere, it
creates `~/.cortex/.env`, tells you what to add, and stops (no half-started server to clean up).

> Running from a checkout instead of a global install? A `./.env` in the repo root works too and
> overrides the global file. It's gitignored, so your keys are never committed.

## Provider API keys

Set the variables for the providers you use (the full annotated list is in `.env.example`):

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Claude (Anthropic) |
| `OPENAI_API_KEY` | OpenAI (GPT / o-series) |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Google Gemini |
| `XAI_API_KEY` | xAI (Grok) |
| `DEEPSEEK_API_KEY` | DeepSeek |

Other providers (Cloudflare Workers AI, Zhipu/GLM, Qwen, Moonshot/Kimi, MiniMax, Mercury)
use the same pattern — see `.env.example`. Run `cortex models list` for the live set.

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
