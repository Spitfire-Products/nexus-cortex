# Secrets vault

nexus-cortex keeps API keys, tokens and passwords in an encrypted vault, `~/.cortex/secrets.enc`, instead of a plaintext `.env`
file. The harness uses the keys without the model ever seeing them, and an agent or script driving the harness never has to type a
passphrase.

```bash
cortex setup                       # keys you enter go to the vault (created on first use)
cortex secrets set GITHUB_TOKEN    # add one (masked prompt; or pipe it in / --from-env VAR)
cortex secrets list                # names + masked previews
/secrets                           # the interactive manager inside neoncortex / fuzzycortex
```

## How it works

- **Format.** The same encryption as the Nexus Terminal SECRETS window: PBKDF2-SHA256 (100,000 rounds) → AES-256-GCM, one
  ciphertext per secret. The file never holds a plaintext value. It is written owner-only (`0600`).
- **Unlocking, without prompts.** At startup the harness tries, in order: `CORTEX_SECRETS_KEY` (the key itself, in the environment) →
  `CORTEX_SECRETS_KEY_FILE` (a file holding it) → the OS keychain (`security` on macOS, `secret-tool` on Linux) →
  `~/.cortex/vault.key` (an owner-only key file, used on machines with no keychain such as servers and containers). If none works the
  vault stays locked and the harness runs without it; it never waits for input.
- **Precedence.** A real environment variable always wins, then the vault, then the `.env` files. A key set by your shell, a CI
  secret or a platform secrets store (Replit, Codespaces, …) is never overridden.

## Commands

| Command | What it does |
|---|---|
| `cortex secrets init [--passphrase]` | Create the vault. Default: a random key kept in the OS keychain, or in `~/.cortex/vault.key` without one. `--passphrase` makes your passphrase the key. |
| `cortex secrets status` | Whether a vault exists, whether it unlocked and how. |
| `cortex secrets set NAME [--provider p] [--stdin \| --from-env VAR]` | Store a value. Never on the command line: a masked prompt, a pipe, or the named variable. |
| `cortex secrets get NAME [--reveal]` | Masked preview; `--reveal` prints the value. |
| `cortex secrets list [--json]` | Names, providers, masked previews, bindings. |
| `cortex secrets delete NAME` | Remove a secret and its bindings. |
| `cortex secrets bind NAME ENV_VAR [--tool T]` / `unbind ENV_VAR` | Let the agent's tools see a secret (below). |
| `cortex secrets import-env [--strip]` | Move keys from `~/.cortex/.env` into the vault; `--strip` blanks them in the file. |
| `cortex secrets exec [--only A,B] -- <command>` | Run any program with the vault's keys in its environment. |

`cortex setup` stores the keys you type in the vault and blanks any old plaintext copy in `~/.cortex/.env`. `--secrets-to env` keeps
the old behaviour (plaintext `.env`).

## What the agent sees

The harness itself uses provider keys from the vault for its model calls. The agent's tools are stricter:

- **Tool processes get only bound secrets.** Commands the agent runs (shell, code execution, tmux, git/gh, artifacts) do not
  receive vault keys unless you bind them: `cortex secrets bind GITHUB_TOKEN GH_TOKEN` exposes `GITHUB_TOKEN` as `$GH_TOKEN` to every
  tool process; add `--tool Bash` to limit it to one tool. Environment variables you set yourself are passed through as before.
- **Every tool result is masked.** Any stored value that shows up in tool output, in plain, base64 or URL-encoded form, reaches
  the model and the screen as `«secret:NAME»`. The same masking applies to the harness's own logs of tool results.
- **`SecretsList`** lets the agent see names, providers and bindings (never values), so it can tell you which secret to bind
  instead of asking you to paste a key into the chat.

**Limits.** This keeps values out of the model's context and out of processes you did not give them to. It is not a sandbox: tools
run as your OS user, so a deliberately hostile command could read `~/.cortex/vault.key` or query the keychain directly. Anything it
printed would still be masked, but a value it sent over the network would not. For stronger separation use a passphrase vault and
supply the key only to the harness (`CORTEX_SECRETS_KEY`), which tool processes never receive, or run tools in a sandbox.

## Headless and orchestrated use

- A container or VM with no keychain: `cortex secrets init` writes `~/.cortex/vault.key`; nothing else to do.
- Keeping the key off the disk: `CORTEX_SECRETS_KEY=… cortex secrets init`, then give the orchestrated harness the same variable.
- Mounting the key: `CORTEX_SECRETS_KEY_FILE=/run/secrets/cortex-vault-key`.
- Every subcommand works without a terminal and has `--json`.

## The browser library (`@nexus-cortex/browser`)

When nexus-cortex is installed alongside it, the local browser library reads from the same vault:

- **Helper keys** for captcha decisions and vision: `TYPESAFE_API_KEY` (Jev), `INCEPTION_API_KEY` (Mercury), `GOOGLE_API_KEY`
  (Gemma; `GEMINI_API_KEY` also accepted), from explicit options, then the environment, then the vault. No other secret is passed.
- **Proxy credentials by reference.** In `set_proxy` rules the model writes `«secret:NAME»` (or `{{secret:NAME}}`) for a username or
  password; the library substitutes the value before the browser uses the rule and masks it in the reply. Only secrets you opt in
  for the browser resolve: `cortex secrets bind PROXY_PASS PROXY_PASS --tool nexus-browser`. Opt-in exists because the model chooses
  the proxy server: an unrestricted reference would let a malicious page ask it to send any secret to an attacker's host.
- **External proxies are allowed by default** on your own machine (the hosted service's default-deny protects a shared, metered
  pool that does not exist locally). Set `NEXUS_BROWSER_PROXY=deny` to turn them off.
