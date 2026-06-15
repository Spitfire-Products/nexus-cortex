# Authentication & API Keys

The easiest way to add a key is the interactive setup — it runs automatically the first
time you start `cortex`, or any time on demand:

```bash
cortex config init
```

It asks which provider you use, takes your API key, and picks a default model — saving them
to `~/.cortex/.env` (a global config, so `cortex` works from any folder). The file is written
user-only (`chmod 600`) and is never committed.

### Where config is read from

Cortex loads, in priority order: a `.env` in your current folder → the package dir →
`~/.cortex/.env` (the global config) → plain environment variables. So you can also just
export a variable instead of using the wizard:

```bash
export ANTHROPIC_API_KEY=sk-ant-…
export DEFAULT_MODEL_ID=claude-sonnet-4-6
```

> **Set a `DEFAULT_MODEL_ID` that matches your key.** The built-in default is a Gemini model,
> so an Anthropic key alone won't be used until you also set the model (the wizard does this
> for you).

## Provider API keys

| Variable | Provider | Example default model |
|----------|----------|-----------------------|
| `ANTHROPIC_API_KEY` | Claude (Anthropic) | `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | OpenAI (GPT / o-series) | `gpt-5-mini` |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Google Gemini | `gemini-2.5-flash` |
| `XAI_API_KEY` | xAI (Grok) | `grok-4.3` |
| `DEEPSEEK_API_KEY` | DeepSeek | `deepseek-v4-pro` |

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
