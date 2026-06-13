# Authentication & API Keys

Nexus Cortex reads all configuration from a `.env` file at the repo root. Copy the tracked
template and add only the keys for the providers you actually use:

```bash
cp .env.example .env        # then edit .env
```

`.env` is gitignored, so your keys are never committed.

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
