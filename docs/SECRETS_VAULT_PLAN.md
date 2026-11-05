# nexus-cortex secrets vault — plan (2026-11-02, operator-approved direction)

## Operator requirements (verbatim intent)
- "OS keychain + passphrase" — but **least user / orchestrator-agent friction**: nexus-cortex is primarily a headless agent driven by other
  agents; the vault must never stall that.
- Model it on **Replit secrets** (values injected into the environment, managed outside the code) and the **SPA SECRETS command**
  (encrypted store; bindings inject a secret as an env var for a command/module).
- "Once the harness has been authed it can use the keys that are encrypted in the store **without ever seeing the keys**" — the LLM never
  sees a secret value; and the harness's own provider keys come from the store as it operates.
- A library version with an interactive menu, instead of typing keys into `.env`.

## Existing pieces to reuse (one scheme on both surfaces)
- SPA crypto: `nexus-terminal/services/secrets/crypto.ts` — PBKDF2-SHA256 100k → AES-256-GCM, Web Crypto only (runs in Node 22).
  Bundle/sync it the same way the browser library bundles the Worker (no fork).
- SPA bindings: `services/secrets/types.ts` `SecretBinding` { scope (global/module/command), secretKey, envVarName }.
- `cortex setup` (`packages/cli/src/commands/setup/index.ts`, plan in `core/src/config/setupPlan.ts`) — today writes keys to
  `~/.cortex/.env` in plain text; it becomes a writer into the vault.
- **Reuse the SPA secrets layer itself (operator 11-02: "apply some of the UI code from the spa SECRETS command")** — same recipe as the
  browser library (bundle unchanged, shim only the platform bits), so fixes carry over:
  - `services/secrets/types.ts` (provider catalog `PROVIDER_CONFIGS` with icons / expected secret types / docs / `keyPatterns` auto-detect,
    `SecretType`, `SecretCategory`, `SecretMetadata`, `ISecretsStorageAdapter`) and `crypto.ts` — no browser deps, used as is.
  - `SecretsService.ts` (get / set / list / delete / import / export / lock) — bundled with its IndexedDB adapter aliased to a NEW local
    encrypted-file adapter (implements `ISecretsStorageAdapter`), the SpacetimeDB adapter + `getSpacetimeDBService` stubbed (cloud sync
    off locally), `window.dispatchEvent` shimmed, `import.meta.env` defined.
  - `commands/standalone/SECRETS/SecretsWindow.tsx` (2.6k lines, React DOM): its FLOWS and pure logic are mirrored in the Ink dialog —
    provider groups with icons + expand/collapse, `PROVIDER_TYPE` key naming, paste-a-key → provider auto-detect via `keyPatterns`,
    masked values with reveal, add form (provider + type), bindings. The DOM rendering itself cannot run in Ink (HTML vs <Box>/<Text>).

## Design
1. **Vault file** `~/.cortex/secrets.enc` (owner-only): JSON of `{ name → { value(enc), category, note, updatedAt } }` + bindings.
2. **Unlock — never blocks a headless run.** Order: `CORTEX_SECRETS_KEY` env (orchestrators pass it; or a key *file* path) → OS keychain
   via each system's own CLI, no native add-ons (`security` on macOS, `secret-tool` on Linux, PowerShell DPAPI on Windows) → passphrase
   prompt **only when a TTY is attached** → otherwise run without the vault and say so once (never hang, never exit).
3. **Harness keys**: at startup the unlocked vault is loaded into the process environment *before* settings load. Precedence: real env >
   vault > `.env`. Every existing reader (`apiKeyEnvVar`, web tools, browser library) works unchanged.
4. **Agent use without seeing values**
   - Tools that start processes (bash / run_command / MCP servers) get **bindings**: secret → env var injected into the child only.
   - The model refers to a secret by **name** (e.g. `$GITHUB_TOKEN` in a command); values are never returned by any tool.
   - **Output masking**: every tool result is scanned and any stored secret value (and common encodings) is replaced with
     `«secret:NAME»` before the model sees it — the GitHub Actions / Replit pattern.
   - A `secrets_list` tool for the agent returns names + categories only.
5. **`cortex secrets` menu** (interactive in a TTY; every action also a flag for agents):
   list (masked) · add / edit · delete · test (one tiny provider request) · bind (secret → env var, scope) · import from `~/.cortex/.env`
   (then strip the keys from it) · lock / rotate the vault key. Categories: model providers · browser (proxy server/user/pass, captcha
   decision-model keys, vision key) · tokens (GitHub, npm, …) · other.
6. **Browser library**: reads its secrets from the same vault (fixes the local "bring your own proxy" gap: a stored proxy implies the
   user allowed it on their own machine); proxies get a menu entry (the VM case).

## Interactive UI (operator 11-02: "an interactive react menu like the ones in fuzzy/neoncortex, e.g. /config or /continue")
- `/secrets` slash command defined ONCE in `@nexus-cortex/core` (`core/src/commands/SlashCommandRegistry.ts`, the source both TUIs use).
- **neoncortex** (Ink app `packages/tui/src/ink-ui/CortexApp.tsx`; dialogs in `ink-ui/components/`, e.g. `ModelPickerDialog.tsx`; `/config`
  handled at `case 'config'` ~line 2302): a `SecretsDialog.tsx` — list (masked) → select → edit / delete / test / bind; add; import .env.
- **fuzzycortex** (launcher: `src/ui/InkMenuPicker.tsx`, `src/ui/ChalkMenuRenderer.ts`, `src/commands/chat/interactive.ts`): the same
  actions through its menu picker.
- Value entry is masked in both; values are never echoed into the transcript or the model context.
- `cortex secrets …` CLI flags remain the agent/orchestrator path (no TTY needed).

## Phases
1. Vault + unlock chain + startup injection + `cortex secrets` flags + `/secrets` dialogs (neoncortex + fuzzycortex) + `.env` import. Tests: unit (crypto
   round-trip, precedence, headless no-TTY path never blocks) + an end-to-end `cortex` run whose provider key exists only in the vault.
2. Bindings + output masking in the tool runner + `secrets_list`. Test: a bash tool prints a bound secret → the model sees `«secret:NAME»`.
3. `cortex setup` writes to the vault; browser library proxy/captcha/vision keys from the vault; docs.

## Status (2026-11-02)
- **Phase 1 — done.** Vault core + unlock chain (c3dd39bad), `cortex secrets` CLI + key-file unlock (2fcea40f5), `exec` (5f1c37073),
  neoncortex `/secrets` dialog on the synced SPA catalog (1fd335fb1), fuzzycortex `/secrets` + the Ink stdin fix (f2281d0f1, aa12d65a9).
- **Phase 2 — done.** `toolChildEnv()` (core `config/secretsVault.ts`) at every spawner of model-chosen code: ShellTool (both paths),
  CodeExecute, GitPolicy (WorkspaceManager / PRAgent), TmuxManager (tmux client + server start, installer), TerminalSandbox, CreateArtifact
  (3 spawns). Children lose the vault keys the startup injected and `CORTEX_SECRETS_KEY[_FILE]`, keep real environment variables, and get
  bindings (global, or `--tool <Name>`). `maskSecretText()` runs at the top of `processToolTraining` (every tool path funnels through it — so
  the decision store's errorSnippet, which is re-injected as priors, and training records are masked too), after both `handleToolCalls`
  loops (synthetic/frame results), and on the R30 sub-agent recovery. `SecretsList` tool: names/providers/bindings, never values.
  Trap found on the way: `bootstrapEnv` runs more than once per process (entry point + OrchestratorFactory per request in stateless
  mode); the session keeps the names earlier passes injected.
  Proven live (server with no provider keys in its real env, DeepSeek key only in the vault): `$DEMO_SECRET` and `$DEEPSEEK_API_KEY` empty
  in the shell, `env | grep -c` = 0, the bound var reaches the shell and shows as `«secret:DEMO_BOUND»`, `cat` of a file holding a value
  shows `«secret:DEMO_SECRET»`, SecretsList names only; no raw value in the session, decision log or server log.
- **Threat model (what Phase 2 does and does not do).** It keeps values out of the MODEL'S CONTEXT and out of tool processes that were not
  given them. It is not a sandbox: tools run as the same OS user, so a deliberately hostile command could still read `~/.cortex/vault.key`
  or query the keychain. Any value it printed would still be masked; a value it sent elsewhere would not. Stronger isolation = a passphrase
  vault (`init --passphrase`, key only in `CORTEX_SECRETS_KEY` of the harness process, which children never get) or a sandboxed tool runner.
- **Phase 3 — done.** `cortex setup` stores the keys it is given in the vault (creates one if needed; a locked passphrase vault is asked
  for at a terminal, a script gets instructions; stale plaintext copies in `~/.cortex/.env` are blanked; keeping an existing key writes
  nothing — before, it copied e.g. a platform secret into the plaintext file; `--secrets-to env` = the old behaviour). Browser library
  (`packages/browser/src/vault.ts`, optional runtime import of core): helper keys TYPESAFE/INCEPTION/GOOGLE (GEMINI accepted) from options >
  env > vault, nothing else; `set_proxy` resolves `«secret:NAME»` / `{{secret:NAME}}` only for secrets bound `--tool nexus-browser` and masks
  them in the reply; external proxies allowed locally unless `NEXUS_BROWSER_PROXY=deny`. User guide: `docs/secrets.md`.
  Found on the way: `bin/cortex.js` did not route `secrets`, `canon`, `features`, `sessions`, `server` — `cortex secrets set X` was sent to
  the MODEL as a chat prompt on an auto-started server (no key leaked: the bin ignores piped stdin). Fixed + guard test
  `packages/cli/tests/binSubcommands.test.ts`.
  Verified: setup 5 scripted scenarios + interactive (new key → vault; keep → nothing written) through the real `cortex` bin; browser
  `test/vault.mjs` 12/12, sandbox 14/14, coverage 50 tools 0 errors, parity IN SYNC, smoke 22/22 with Xvfb available.
  (Correction 2026-11-03: the smoke `save_auth` failure first read as "incognito keeps localStorage" was a misleading test message — the
  incognito browse had failed to LAUNCH (no Xvfb on PATH), and `evaluate` on the missing page returned undefined, not null. Incognito
  isolation is correct. The check now reports the browse result; the library warns at startup when Xvfb is missing and appends an
  install hint to the no-X-server launch error.)
