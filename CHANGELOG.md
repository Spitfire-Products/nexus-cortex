# Changelog

All notable changes to Nexus Cortex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.34.5] - 2026-06-16

### Fixed

- **`cortex mcp enable` / `disable` / `tools` / `status` now auto-start the cortex server**
  when it isn't running, instead of failing with a bare `fetch failed`. These subcommands talk
  to the server over HTTP, but the `cortex` bin delegated them without ensuring the server was
  up. (File-only subcommands like `mcp init` are unaffected.)

---

## [4.34.4] - 2026-06-16

### Fixed

- **MCP http connections (e.g. the `browse` tool / `nexus-browser`) no longer fail with a bare
  `fetch failed` on Node 22+ (including Node 23).** The MCP client attached a keep-alive
  dispatcher built from the standalone `undici` package, whose `Agent` is incompatible with
  Node's newer built-in `undici` (Node 23 ships undici 7) — Node's `fetch` rejected it as an
  opaque `fetch failed`, breaking every http MCP server. The client now **retries the connection
  without that dispatcher** when the first attempt fails, so it succeeds on every Node version
  (the dispatcher is only a cosmetic SSE keep-alive; the SDK still reconnects genuine idle drops).
- **MCP connection errors now surface the underlying cause** (`error.cause` — a TLS error,
  `ECONNRESET`, etc.) instead of a contextless `fetch failed`.

---

## [4.34.3] - 2026-06-16

### Changed

- **`nexus-browser` is now the standard browser-automation MCP server.** Previously the MCP
  server registry and `mcp init` offered `puppeteer` (a local `npx` server), but the built-in
  `browse` tool only drives `nexus-browser` (the hosted, auto-provisioning service) — so a
  generated config never matched the tool, and `browse` failed with `fetch failed`. `puppeteer`
  is removed from the registry; `nexus-browser` is the registered, recommended browser server,
  so the config the harness generates now actually works with `browse`.

### Fixed

- The `update` / `uninstall` messages referenced a non-existent `cortex-cli` command; they now
  say `cortex` (the only published binary).

---

## [4.34.2] - 2026-06-15

### Fixed

- **The default model now honours your `DEFAULT_MODEL_ID` and falls back to the documented
  default.** The server hardcoded `gemini-2.5-flash` as its startup fallback (and the messages
  route hardcoded `grok-code-fast-1`), so when `DEFAULT_MODEL_ID` wasn't visible it silently used
  gemini and demanded `GEMINI_API_KEY` — even if you'd set `deepseek-v4-pro`. Both fallbacks now
  use the canonical schema default (`DEFAULT_SETTINGS.DEFAULT_MODEL_ID` = `deepseek-v4-pro`), so
  there's a single source of truth for the default model. (Combined with 4.34.1, a `DEFAULT_MODEL_ID`
  set in `~/.cortex/.env` is now both read and applied.)

---

## [4.34.1] - 2026-06-15

### Fixed

- **API keys set in `~/.cortex/.env` are now actually used at runtime.** The server loaded only
  `./.env` into `process.env`, so keys written to the global `~/.cortex/.env` (by `cortex config
  set` / `config init`) were visible to config introspection but never reached the model and
  web-tool clients, which read `process.env` directly — producing `API key not found in
  environment variable: GEMINI_API_KEY` even with the key set. The server now also loads
  `~/.cortex/.env` at startup, at the lowest priority (a project `./.env` still overrides it).

---

## [4.34.0] - 2026-06-15

### Added

- **Global config at `~/.cortex/.env`.** Settings now load from `~/.cortex/.env` in your home
  directory, so a globally-installed CLI is configurable from anywhere — you no longer need to
  find where npm placed the binary. A project-local `./.env` still overrides it.
- **`cortex config init`** — create an editable, schema-templated `~/.cortex/.env` you can open
  and fill in by hand (`--force` refreshes the template while preserving your values).
- **`cortex update`** — update the global install to the latest published release, with visible
  npm output.
- **`cortex uninstall`** — remove the global install (keeps your `~/.cortex` config unless
  `--purge`; requires `--yes` when run non-interactively).
- **`CORTEX_UPDATE_POLICY`** — controls the startup update check: `auto` (default: a one-line
  notice when interactive; a non-zero exit when run programmatically, so unattended/automated
  deployments don't silently run a stale version), plus `off` / `warn` / `error` / `force`.

### Changed

- **`cortex config set KEY VALUE` now writes to the global `~/.cortex/.env`** (and prints the
  path) instead of a `.env` in the current directory, so settings persist across directories
  and survive package updates.

---

## [4.27.0] - 2026-06-15

### Added

- **`--add-dir <dir>` + approval-gated workspace boundary.** Tools now treat the project root
  (your launch directory) as the boundary. When the model targets a path outside it, the request
  goes through the permission system instead of being silently rejected: you're prompted to allow
  it (the model is told to explain *why* it needs to cross the boundary), `--add-dir <dir>` pre-grants
  a directory, and `--yolo` auto-approves. Same model as `claude --add-dir`.
- **`--system-prompt-file <path>` (server flag + `CORTEX_SYSTEM_PROMPT_FILE`).** Swaps just the core
  `system_prompt` message for an alternate file — tool guides, project context (CORTEX.md), and
  prompt-cache stability are untouched. Useful for A/B-testing an alternate persona/system prompt.
- **`ENVIRONMENT_INFO` and `WORK_QUALITY` system messages now ship** with the package. They provide
  working-directory/path-resolution grounding and the core work-quality protocols (decisiveness,
  grounded references, TDD, output efficiency) that previously lived only as local overrides.

### Changed

- **Unified project-root resolution (the cwd model).** The launch directory is the canonical project
  root for tools, sub-agents, sessions, and system messages. An explicit `PROJECT_PATH` (headless
  use) now becomes canonical and `PROJECT_ROOT` is derived from it, so the two can never diverge and
  silently mis-root operations. A startup `[WARN]` fires if `PROJECT_PATH` differs from the cwd.

### Fixed

- **System prompt was being shadowed by stale local overrides.** On machines with a `~/.cortex/` or
  project `.cortex/system-messages/` copy, the loader served an older prompt instead of the shipped
  one — bypassing the current steering. The shipped masters are now authoritative.
- **Removed the dead `PROJECT_ROOT` env knob** from `.env`/`.env.example`: due to startup load order
  it could never take effect, yet was documented as an override. `PROJECT_PATH` is the single knob.

## [4.26.2] - 2026-06-13

### Added

- **One-command install.** A new `nexus-cortex` meta-package installs the `cortex` CLI and the
  HTTP server together — `npm install -g nexus-cortex`, then just run `cortex "…"` (the server
  auto-starts). The individual `@nexus-cortex/cli` and `@nexus-cortex/server` packages are still
  published for those who want to install components directly.
- **`CONTRIBUTING.md`** — development setup, project layout, and PR guidelines.

### Changed

- **Slimmed the README to a landing page.** The reference material that read like a manual moved
  into `docs/user-guide.md` (the full CLI, HTTP server, REST API, sessions, PR review, deployment,
  troubleshooting) and `docs/architecture.md` (monorepo layout and the core systems). The README is
  now a quick start plus links. Getting started is: install, rename `.env.example` to `.env` and add
  one provider key, then `cortex "…"`.

## [4.26.1] - 2026-06-13

### Fixed

- **`cortex --version` / `-v` now works standalone.** It prints the version and exits
  immediately, with no server required. Previously `--version` was treated as a prompt and
  tried to auto-start a server, printing a confusing "Server not built" error.
- **`cortex` resolves the server from an npm install.** When run outside the monorepo, it
  now locates `@nexus-cortex/server` through `node_modules` instead of only looking at the
  monorepo build path. If the server still isn't found, the message points to the right fix
  for each case (`npm install @nexus-cortex/server` for npm users, `npm run build` from
  source).

## [4.26.0] - 2026-06-13

### Added

- **Splash-screen tooling for branding the terminal UIs.** A guided interactive
  configurator (`packages/cli/themes/chalk/splash_configurator.py`) builds the startup
  splash — the microprocessor "chip" art with a word inside it and a large title banner
  below — and writes it directly into the TUI. Run it with no arguments for a numbered
  menu that previews the whole splash, lets you change the chip word and banner text, pick
  a banner style, resize it, and save.
- **Vector-font banner rasterizer.** Banners are rendered from a real vector font
  (Orbitron) into terminal character art in three styles: solid half-blocks, an LED
  dot-matrix (with optional coverage shading), and fine braille dots. This replaces the
  single hand-drawn figlet banner and lets the title use the same letterforms as the
  README hero.
- **Per-brand splash screens.** `fuzzycortex` and `neoncortex` now have independent splash
  art — each can carry its own chip word, banner, and style — selectable in the
  configurator. The splash text is plain characters; all colors come from the active theme
  at render time, so switching themes in the theme picker recolors the whole splash.
- **README hero artwork.** A self-contained SVG hero (`docs/assets/nexus-cortex-hero.svg`)
  rendered from the same chip art plus an outlined Orbitron banner, with a generator
  (`svg_hero_generator.py`) supporting multiple color palettes.

---

## [4.25.0] - 2026-06-13

### Changed

- **`ENABLE_DASHBOARD` is now a true master switch.** When `false` (the default), the
  tmux/sandbox web dashboard never starts — not at server boot and not via the tools'
  demand-start paths (`TmuxSession`, `CreateArtifact`), so no extra port is ever bound.
  Tool results replace the view URLs with explicit guidance: set `ENABLE_DASHBOARD=true`
  to enable, and check for a port conflict on `DASHBOARD_PORT` (default 4001; the server
  retries up to 10 consecutive ports) if it then fails to start. Previously the flag only
  controlled the boot-time start, and any tmux/artifact use would still demand-start the
  dashboard — a surprise in headless/container deployments.

---

## [4.24.1] - 2026-06-12

### Fixed

- **`cortex-server` (and the npm bin path generally) now actually starts the server.** The
  module's direct-run guard compared `import.meta.url` to `argv[1]`, which is the *bin
  wrapper* when installed from npm — so `cortex-server` loaded the module and silently
  exited 0. The server now exports `main()`, the bin invokes it explicitly, and the
  direct-run check compares realpaths (robust to npm's symlinked global bins). Caught by a
  full local-registry publish/install rehearsal before any public release.

---

## [4.24.0] - 2026-06-12

### Fixed

- **Browser-integration suite repaired** (`ENABLE_BROWSER_TESTS=true` → 4/4): the apparent
  React-introspection regression was a test-infrastructure fault — an orphaned static server
  on a fixed port from an interrupted run. The suite now uses an in-process server on an
  ephemeral port (no external download, no port collisions, no orphanable processes). The
  introspection feature itself was verified healthy.
- **`models list` headline count** now reports unique models with aliases noted separately
  (e.g. "84 + 9 aliases"), matching the README's auto-counted total.
- Numeric model-count comments removed from card index files and the registry (the registry
  is self-describing; literals drift).

### Removed

- Internal archive/backup directories and stale per-package lockfiles (npm workspaces use
  the root lockfile) no longer ship.

---

## [4.23.1] - 2026-06-12

### Removed

- The five `spacetimedb-*` reference skills no longer ship — they are platform tooling for a
  separate project, not part of the cortex harness. The shipped skill library is now:
  `autoresearch` (+ the persona library), `cortex`, `cortex-bench`, `best-of-n`, `verify-work`,
  `docx`, `xlsx`, `pptx`, `pdf-documents`, `resume-analyst`.

---

## [4.23.0] - 2026-06-12

### Fixed

- **Deprecated model names now auto-migrate.** The registry resolves back-compat aliases on
  lookup (`deepseek-chat` → `deepseek-v4-flash`, `deepseek-reasoner` → `deepseek-v4-pro`),
  so existing configs, sessions, and scripts using the deprecated DeepSeek names keep working
  after the July-2026 removal. The alias map existed but was never consulted on the
  server/orchestrator path — found by a pre-publish audit's behavioral probe.
- **Pre-publish audit sweep** (6 parallel in-harness audit agents + ground-truth verification):
  - Quickstart, provider table, agent-profile guide, and CLI help no longer reference the
    removed DeepSeek model names.
  - Removed internal project references and stale attribution comments from shipped source,
    skills, and the health dashboard.
  - Removed dead package scripts (`dev:full`, `demo:full`) that referenced unshipped files.
  - Corrected stale claims: hardcoded model/provider counts in the cortex skill, a stale
    line-count claim in the server header, a nonexistent file path in a README example,
    an undocumented `npm run format`, legacy audit-log paths in two permission profiles,
    and unregistered example model IDs in the settings schema.
  - The spacetimedb skills no longer carry workspace-specific deploy/auth sections.
  - References to the not-yet-published auto-research MCP are now generic ("the configured
    auto-research MCP") until that server ships.

---

## [4.22.0] - 2026-06-12

### Added

- **Fresh-install onboarding memory.** A new install now ships `.cortex/MEMORY.md` seeded
  with a first-agent orientation — injected on the very first turn, it explains how to run
  `/init` (generates `CORTEX.md` + project memory), how to discover the shipped skills
  (`Skill` → `list`) and agent profiles (`Task` → `list`), where configuration lives, and the
  memory-maintenance discipline — then instructs the agent to replace it with real project
  memory. The `/init` auto-created memory template carries the same capability-discovery
  pointers for installs that start without the seed.

---

## [4.21.0] - 2026-06-12

### Added

- **15 skills out of the box** (`.cortex/skills/`, auto-vendored into npm tarballs):
  - `autoresearch` (the PM playbook) + a new **arm persona library** — 8 named personas
    (`precise`, `aggressive-refactor`, `root-cause`, `test-first`, `security-auditor`,
    `perf-hunter`, `creative`, `skeptic-reviewer`), each a ready-made `strategy` label that
    feeds the (model × temperature × strategy) effectiveness matrix
  - `cortex-bench` (benchmark methodology), `cortex` (the headless-agent usage + debug reference)
  - `best-of-n` (parallel implementation tournament) and `verify-work` (adversarial
    verification subagent) — and both are now composed into the bench/autoresearch playbooks
    (the FIX step can run as a tournament; the VERIFY step follows the refute-don't-confirm checklist)
  - Document skills: `docx`, `xlsx`, `pptx`, `pdf-documents` (create/read/edit Word, Excel,
    PowerPoint, and PDF deliverables with built-in verification steps — also ideal graded
    bench-task surfaces)
  - `resume-analyst` and five `spacetimedb-*` reference skills
- **Root `test` / `test:ci` / `typecheck` scripts** — the commands the README documents now
  exist (npm-workspaces delegation).
- `ENABLE_BROWSER_TESTS` env (default false) — the Chromium browser-integration suite is now
  opt-in, so the default `npm test` is deterministic on a fresh clone.

### Fixed

- `npm publish` would have failed: the `prepack` scaffold-vendoring script now ships in the
  repo (`scripts/copy-pkg-cortex-scaffold.mjs`).
- `/models` endpoint test no longer hardcodes a model count — it compares against the live
  registry, so adding/removing models can't break the suite.
- Scrubbed stale internals from shipped docs/skills: dead `OMNICLAUDE_*` env names →
  `CORTEX_*`, unregistered example model IDs, hardcoded tool/test counts, absolute paths.

### Verified

- **Full end-to-end from a fresh clone**: install → multi-pass build → typecheck (0 errors) →
  `npm test` green (2,000+ tests) → server `/health` → CLI introspection → `npm pack`
  (scaffold vendored).
- **Benchmark pipeline e2e**: deterministic graded bench (arm labels + backlog seeding) →
  base-vs-candidate experiment (`keep`, p=0.003, FWER-adjusted, holdout-verified,
  mergeEligible) → live-LLM bench through the server with real graded records.

---

## [4.20.0] - 2026-06-12

### Added

- **The `.cortex/` scaffold now ships in npm installs.** Previously the builtin agent
  profiles (including `autoresearch-agent`), skill playbooks, sample bench tasks, and
  permission examples only existed in a git clone — npm tarballs shipped bare `dist`+`bin`,
  so an `npm install`ed user silently had no builtin agents or skills. Now:
  - `prepack` vendors the shippable scaffold (agents, skills, commands, system-messages,
    bench/tasks, permission profiles) into the `@nexus-cortex/cli` and `@nexus-cortex/server`
    tarballs.
  - The `cortex` bin and the server entry resolve `CORTEX_ROOT` automatically — the monorepo
    root in a git clone, or the package's own vendored scaffold under `node_modules`. An
    explicitly set `CORTEX_ROOT` always wins.
  - The `Skill` tool gains a **builtin tier** (`$CORTEX_ROOT/.cortex/skills`, lowest
    priority — project and personal skills override by name), mirroring the agent store's
    existing builtin tier.
- All *runtime* state (sessions, artifacts, tmux metadata, training records, the JSONL
  ledgers, config.json) continues to be created on demand — no install step required.

---

## [4.19.0] - 2026-06-12

### Added

- **`--temperature` / `--strategy` flags on `autoresearch bench`, `experiment`, and `loop`** — so a
  CLI caller (not just an env-stamped subagent) can label a run's effectiveness arm. The labels are
  recorded with every scored run (on both base and candidate in an experiment), feeding the
  (model × temperature × strategy) ranking added in 4.18.0. Both fall back to the
  `CORTEX_SUBAGENT_TEMPERATURE` / `CORTEX_ARM_STRATEGY` env stamp when omitted.

---

## [4.18.0] - 2026-06-12

### Added

- **Strategy-aware effectiveness tracking** — the router matrix now scores benchmark results per
  **(model × temperature × strategy)** arm, not just per model. The auto-research PM can see *which
  variation* — a given model at a given temperature running a given persona/strategy — has produced
  the best work on a task, and reuse the strongest known arm while diversifying the rest. New matrix
  methods `getStrategyScores` / `recommendStrategy` surface the ranked arms; this is the cortex-bench
  benchmarking loop applied to strategies, reusing the existing composite scoring + compaction (no
  new store).
- **`Task` `strategy` param** — a short persona/strategy label (e.g. `"precise"`, `"aggressive-refactor"`)
  recorded alongside the `model` and `temperature` of each parallel arm, so the effectiveness layer
  learns over time. Both axes auto-capture from the dispatched subagent — no manual logging.

### Notes

- Fully back-compatible: records without a temperature/strategy collapse to the single arm they
  always were, and **model routing (`recommend`) is unchanged** — it still groups by model only.

---

## [4.17.0] - 2026-06-12

### Added

- **Per-subagent temperature** — the `Task` tool gains a `temperature` param, so a PM running
  parallel auto-research arms can vary sampling temperature per agent (a real diversity lever
  alongside the `model` override). It threads to the forked subagent's request, and is
  **clamped to the chosen model's valid range** in the shared API path (e.g. Anthropic 0–1,
  OpenAI/DeepSeek 0–2) so a high temperature can't 400 a narrow-range model.

---

## [4.16.0] - 2026-06-11

### Changed

- **The auto-research PM is now plan-gated.** Before delegating to `autoresearch-agent`
  subagents, the PM must produce an experiment plan — and the harness now **enforces** it,
  context-switched by how it's accessed: an interactive TUI requires the plan be drafted +
  approved in **plan mode** (`EnterPlanMode`); a headless CLI/server requires a **TodoCreate**
  planning checklist. A launch without a plan is rejected with guidance, so the failure mode
  where agents spin without a measurable target can't happen. The plan must define the metric,
  pass/fail criterion, base-vs-candidate control (train + holdout), per-subagent variation, and
  continue/fail rules.
- **Per-subagent variation** — the PM now assigns each arm a distinct strategy/persona and can
  vary the `model` per dispatch, so N agents explore differently (diverse search) while the
  metric + gate stay identical across arms (one shared judge). Identical clones waste the
  parallelism.
- **`autoresearch-agent` fail-fast rules** — if a deficiency has no measurable eval/repro/task-set,
  the agent reports it and stops within a few turns instead of exploring indefinitely; a turn
  budget and mandatory backlog update were added.

---

## [4.15.0] - 2026-06-11

### Added

- **Auto-research subagents** — a `.env`-gated CLI feature (`AUTORESEARCH_AGENTS` = `off` |
  `native` | `mcp`, default `off`). When enabled, the main model acts as a **PM**: for
  self-improvement / "set up an experiment" requests it **delegates to ~4–5 dedicated
  `autoresearch-agent` subagents** on one backlog deficiency, instead of running the
  experiments itself. The auto-research tool surface + workflow live in those subagents, so
  the main model's context stays clean (the same isolation as the browse-agent). `native`
  runs experiments with the internal tools; `mcp` routes experiment-running to the external
  `nexus-cortex/autoresearch` MCP server. Off by default — the PM is never even told about it.

---

## [4.14.0] - 2026-06-11

### Added

- **`cortex autoresearch experiment` runs on any project, not just the cortex harness.**
  An `ExperimentTarget` seam lets `--run-cmd`/`--build-cmd`/`--accept-exit` grade a shell
  command per arm instead of building+serving a cortex server, so a library, CLI, test
  suite, or backtest gets the same base-vs-candidate statistical gate. Off-git arm dirs
  fall back to a basename label.
- **`cortex autoresearch loop` — the autonomous loop.** Fix → measure base-vs-candidate →
  keep only what verifies → advance the base → repeat, until a success metric, max rounds,
  or a dry backlog. Each round runs in a throwaway worktree off a dedicated `autoresearch/loop-*`
  branch, so **your branch and working tree are never touched** (accepted commits are anchored
  to the loop branch; merge it when satisfied). `--fixer-cmd` plugs any transformer in place of
  the LLM Fixer; `--holdout-set` gates merges on out-of-sample verification (without it, merges
  are train-only and flagged unverified); `--success-metric <taskId:threshold>` stops early.

---

## [4.13.0] - 2026-06-11

### Added

- **Auto-research can now measure any project, not just the cortex harness.**
  `cortex autoresearch bench` gained `--run-cmd <template>` (plus `--build-cmd`, `--cwd`,
  `--accept-exit`) to grade a **shell command** per task instead of a cortex server — so a
  library, CLI, test suite, or backtest runs through the same statistically-gated bench.
  The command's stdout is graded by the task's verifier; a non-accepted exit code fails the
  task (and seeds the backlog).
- **Numeric verifier** for task sets: `{ "type": "numeric", "direction": "maximize" | "minimize",
  "extract"?, "best"?, "worst"?, "target"? }`. Extracts a number from the output (a custom
  regex capture group, or the last number by default) and scores it continuously, so any
  metric — ROI, latency, accuracy, tour length — can drive keep/discard. `target` sets the
  pass threshold; `best`/`worst` map the value to 0–100.
- **Deterministic backlog seeding.** A failing benchmark verifier now auto-records a
  deficiency in `.cortex/research-backlog.jsonl` (idempotent per task, confidence scaled by
  how consistently it failed), so a failure is captured even when nothing thought to log it.
  `--no-seed-backlog` opts out; the holdout split never seeds.

---

## [4.12.0] - 2026-06-10

### Added

- **`cortex agent` (alias `cortex run`).** A one-shot, autonomous headless agent: point it at a
  task and a working directory, and it runs to completion and exits. Because a headless run has
  no interactive approver, it auto-approves tool actions by default. Supports `--cwd`, `--model`,
  and `--json` (machine-readable result) — the building block for running Cortex as a callable
  agent in CI or a container.

### Changed

- **DeepSeek lineup trimmed to V4.** Removed `deepseek-chat` and `deepseek-reasoner` — DeepSeek
  retires both on 2026-07-24. `deepseek-v4-flash` supersedes chat and `deepseek-v4-pro` supersedes
  reasoner; the old names now resolve to those successors, so existing model selections keep
  working. The default helper model is now `deepseek-v4-flash`.
- **Public README reframed** around what Cortex is — a headless, multi-provider agent harness:
  added a peer-harness comparison, provider maturity tiers (which providers are proven end-to-end
  vs. preview), and a tour of the advanced tooling surfaces. The full environment-variable
  reference moved to `docs/configuration.md`.
- **`GIT_ALLOWED_REPOS` no longer warns on startup.** When unset (all repos permitted) the git/PR
  tools used to print a warning on every launch; that is gone. The trade-off and how to restrict
  access are documented in `.env.example`.

### Fixed

- **`cortex` one-shot commands no longer hang.** When a one-shot invocation auto-starts a
  background server, the client now detaches that server's stdio pipes once it is healthy, so the
  command exits cleanly instead of blocking on the open pipe.

---

## [4.11.0] - 2026-06-10

### Added

- **Project agents discoverable from any directory.** Agents shipped with the install
  (under `$CORTEX_ROOT/.cortex/agents`) now load no matter where you launch from, and the
  `project` tier walks up from the current directory to the nearest `.cortex/agents` — so a
  project's agents resolve even when you start the tool from a subdirectory.
- **Agent scope marker.** Listing agents (`Task` with `subagent_type: "list"`) now shows a
  `Scope` column marking which agents are specific to the current project (`*`) versus
  personal (`~/.cortex`) or shipped builtins.

### Fixed

- **CLI introspection commands repaired.** `cortex tools list` (was reporting zero tools),
  `tools info`, `models list` / `info` / `switch`, `mcp list`, and `cache metrics` now
  return correct data and exit cleanly instead of hanging on open MCP connections.
  (`models info` also no longer crashes on a field-name mismatch.)
- **`cortex permissions` works headless.** `grant`, `revoke`, `policies`, `tools`, `mode`,
  `set`, and `auto-approve` now read and write the active permission profile file directly
  — persisting across runs — instead of failing with "fetch failed" when no server is
  running. Grants/revokes target the project-level profile only, never your global
  `~/.cortex` one. Honors `PERMISSION_PROFILE` (default `dev`).
- **Browse sub-agent uses the real browser tools.** The headless `browse` agent's tool
  whitelist is now enforced, so it can no longer fall back to `WebFetch`/`WebSearch` and
  drives the nexus-browser MCP tools as intended.
- **nexus-browser MCP no longer floods the terminal UI.** Transient SSE stream drops are
  handled quietly (the client auto-reconnects), and an HTTP keep-alive setting prevents the
  idle stream from being terminated every few minutes — so the TUI is no longer spammed
  with `SSE stream disconnected` errors.

---

## [4.10.0] - 2026-06-10

### Added

- **Claude Fable 5 model** (`claude-fable-5`) — Anthropic's top-tier model, registered
  across the Anthropic provider with adaptive-thinking support (1M context, 128K output).

### Changed

- **Hardened the git/PR & worktree tools.** `PRAgent` and `WorkspaceManager` now shell
  out without a shell (`execFile` with argument arrays) and validate every repo/branch/PR
  input, closing shell- and argument-injection vectors. A new opt-in allow-list governs
  what they can touch — `GIT_ALLOWED_REPOS`, `GIT_ALLOWED_ACTIONS`, `GIT_AUTH_TOKEN`
  (kept in the subprocess env, never on argv or in a URL), and `GIT_HOST` (GitHub
  Enterprise). The `/v1/pr/webhook` endpoint now verifies GitHub's `X-Hub-Signature-256`
  HMAC (`GITHUB_WEBHOOK_SECRET`) and is disabled unless a secret is set.
- **Cleaner worktree lifecycle** — `cleanup` removes the worktree, the branch it created,
  and (for clones) the clone directory; uses the OS temp dir; surfaces real subprocess
  errors; honors cancellation.

### Fixed

- **EndTurn no longer rejects valid attestations.** The end-of-turn audit tool stopped
  looping on well-formed input that omitted optional evidence arrays, and it's no longer
  surfaced to the model when its gate is disabled.

### Security

- **`.env` is now gitignored** so your API keys and `CLAUDE_CODE_OAUTH_TOKEN` are never
  committed. Copy `.env.example` to `.env` to configure.
- **`.cortex/config.json` (UI preferences) can never hold a secret** — a save-time guard
  strips any secret-looking key before writing this tracked file.

### Documentation

- **Full feature-set documentation audit.** Removed stale model names (Claude 3 Opus,
  GPT-4 Turbo, Grok 2, …) in favor of the current registry, and documented the
  previously-undocumented headline capabilities: sandboxed artifacts + React
  introspection, sub-agents (`Task`), auto-research (`cortex autoresearch`), the
  permission system, model router, mentorship, the git/PR tools, and the structured
  `cortex <group>` command set. Fixed broken README links.
- **Auto-updating doc counts.** The README's tool / model / provider / slash-command
  counts are generated from the live registries (`scripts/update-doc-counts.mjs`) rather
  than hardcoded — refreshed on every build and enforced in CI, so they can never silently
  drift. Run `npm run docs:counts` to refresh manually.
- **Complete environment-variable reference** in the README — every supported variable,
  its default, and how to use it.
- **Claude credential guide** — where to put the OAuth token
  (`~/.claude/.credentials.json` via `claude login`, or `CLAUDE_CODE_OAUTH_TOKEN`), the
  resolution order, and the `ANTHROPIC_AUTH_METHOD` switch.

---

## [4.9.0] - 2026-06-10

Initial public release of the Nexus Cortex monorepo (Release 1: the engine).

### Packages

- `@nexus-cortex/types` — shared TypeScript interfaces (zero runtime deps)
- `@nexus-cortex/core` — orchestration engine, adapters, middleware, sessions, models, MCP
- `@nexus-cortex/executors` — built-in tool implementations
- `@nexus-cortex/server` — optional Express HTTP server
- `@nexus-cortex/cli` — headless command-line interface (`cortex`)
- `@nexus-cortex/tui` — React/Ink terminal UI (deferred to Release 2; not in this release)

### Features

- **Multi-provider orchestration** across Anthropic, OpenAI, Google (Gemini /
  Vertex + Gemma), xAI, Cloudflare Workers AI, DeepSeek, Zhipu/GLM, Qwen/DashScope,
  Moonshot, MiniMax, and Mercury (Inception) — via a pluggable adapter layer
  (Messages, Chat Completions, GenerateContent, GenAI, Responses).
- **Built-in tool suite** — file operations, search (glob/grep), web
  fetch/search, shell execution, sub-agent dispatch, conversation-history tools,
  and sandboxed artifacts, with a dual registry (immutable base tools + dynamic
  addon tools).
- **Sandboxed artifacts with visual feedback** — `create_artifact_tool` spins up
  persistent web/server artifacts (tmux-managed) with screenshots, DOM, console,
  network, and accessibility snapshots the model can iterate against
  (`inspect_sandbox`, `interact_with_sandbox`, `modify_sandbox` with hot reload).
- **React artifacts** — `framework: "react"` builds a React app from a single
  component (no hand-written HTML): zero-install CDN mode, or an esbuild-bundled
  mode with real source maps and automatic re-bundling on edit. React and esbuild
  ship as optional dependencies; CDN mode needs nothing.
- **React introspection senses** — `sandbox_detect_framework`, `sandbox_scan`
  (elements with stable `cssSelector`, `componentName` on React pages),
  `sandbox_grab` (DOM detail + `react: { componentName, componentStack, props,
  sourceLocation }` — source-mapped to real `src/*.tsx` lines in bundled mode),
  `sandbox_component_tree` (fiber hierarchy), and `sandbox_render_trace`
  (per-component re-render counts/timings across interactions). The scan → act →
  scan loop and element contracts mirror common browser-automation MCP tools, so
  skills transfer between surfaces.
- **MCP integration** — connect Model Context Protocol servers and optionally
  auto-inject their tools.
- **Context management** — token-budget tracking, helper-model compaction, and
  prompt caching, with sliding-window or priority-based strategies.
- **Session persistence** — append-only JSONL history with UUID message IDs and
  content-addressable file checkpoints.
- **Permission system** — dev/test/prod profiles with whitelist, blacklist,
  file-operation, and command policies.
- **Git/PR access control** — the PR-review and worktree tools shell out via
  `execFile` (no shell) with validated inputs, and honor an opt-in allow-list:
  `GIT_ALLOWED_REPOS`, `GIT_ALLOWED_ACTIONS`, `GIT_AUTH_TOKEN` (env-only, never on
  argv/URL), and `GIT_HOST` (GitHub Enterprise). The `/v1/pr/webhook` endpoint
  verifies GitHub's `X-Hub-Signature-256` HMAC (`GITHUB_WEBHOOK_SECRET`) and is
  disabled unless a secret is set.
- **System messages** — auto-loaded project context (`CORTEX.md`) and custom
  hot-reloaded system prompts.
- **Optional model router** — task-aware model selection from recorded
  performance history (off by default), with a multi-entry exclude list
  (`MODEL_ROUTER_EXCLUDE`, exact IDs or `prefix*` wildcards) honored by both
  greedy and exploration routing.
- **Server lifecycle controls** — inactivity auto-shutdown (`SERVER_IDLE_TIMEOUT`),
  graceful shutdown with connection draining (`SHUTDOWN_GRACE_MS`), session
  resume on boot (`AUTO_RESUME` / `RESUME_SESSION_ID`), and an opt-in
  sandbox/tmux dashboard (`ENABLE_DASHBOARD`, `DASHBOARD_PORT` — off by default;
  tmux/viewer tools lazily start it on demand regardless).
- **Interfaces** — headless `cortex` CLI for scripting and an optional HTTP
  server exposing the orchestrator over REST/SSE. Interactive terminal UIs
  arrive in Release 2.

### Configuration

- All settings are documented in `.env.example`; provider API keys are read from
  the environment. See `README.md` for configuration beyond environment variables
  (agents, commands, MCP servers, and permissions live under `.cortex/`).

### License

- Apache-2.0 (explicit patent grant; `NOTICE` ships with every package).
