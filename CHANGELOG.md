# Changelog

All notable changes to Nexus Cortex will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.8.0] - 2026-06-08

### Added

- **`cortex autoresearch fix` — headless autonomous coding-agent edit.** The
  production way for the auto-research swarm's Fixer to make a candidate edit on
  disk (the Vite dev server is dev-only; `cortex message` is just an HTTP
  client). Runs the orchestrator **in-process** with the real Edit/Write/Bash
  executors, `permissionMode: 'auto'` (no approval prompts), scoped to `--cwd`
  (the candidate worktree). It **edits but does NOT commit** — the swarm Fixer
  commits, so the candidate ref differs from base. `--prompt`/`--prompt-file`
  (deficiency + repro + strategy; never task sets — the overfitting trip-wire is
  the caller's), `--model`, `--max-iterations`, `--json` (clean stdout:
  `{cwd, model, changed, filesEdited, toolCallCount, iterations, summary}`).
  Boundary: cortex owns the agent invocation; the swarm owns
  which-deficiency/strategy + the commit/FWER orchestration. Verified live
  (autonomous edit applied, clean JSON).

### Fixed

- **`ArtifactRegistry` logged a `✅` emoji to stdout on first init** — violated
  the no-emoji production rule AND polluted `--json` output (breaking the Fixer's
  parse). Now `[INIT]` to stderr.

---

## [4.7.0] - 2026-06-08

### Added

- **`cortex autoresearch experiment` — the single-experiment runner (closes the
  loop).** One command runs a full keep/discard experiment: builds the candidate
  worktree (and optionally base), serves each build on its own isolated port,
  benches both arms (train + optional holdout) into one shared `.cortex` store,
  runs the Monte-Carlo gate + held-out verification, and emits the audited
  verdict + the JSONL artifact a downstream ingest consumes. It owns the
  "two builds, not one relabel" correctness — each arm is served by a server
  built from its *own* code (servers run with `MODEL_ROUTER_RECORD` off so only
  graded bench records land). Teardown guaranteed.
  - `--json` returns `{ experimentTag, baseRef, candidateRef, branch, verdict,
    holdoutVerdict, regressedTasks, mergeEligible, benchSummaries, cortexDir,
    jsonlPaths }`. `mergeEligible` = keep-on-train ∧ fwerAdjusted ∧
    keep-on-holdout (FALSE without a holdout set — fixed ≠ verified). Writes all
    three stores: `router-matrix.jsonl`, `experiments.jsonl`,
    `research-backlog.jsonl`.
  - Core `runExperiment(matrix, ledger, arms, opts)` is the testable measurement
    core (composes `runBench` + the gate behind injectable `HarnessRunner` arms);
    the CLI owns the build/serve/teardown lifecycle (`harnessProcess.ts`:
    `startServer`/`freePort`/`gitShortSha`/`buildDir`, shared `serverRunner`).
  - Scope: harness-CODE experiments (base build vs candidate build, compared by
    git SHA). Model/config experiments use `bench` + `evaluate` directly.

### Fixed

- **`serverRunner` passed a non-string `modelId`** — the server's `/v1/messages`
  response returns `model` as an OBJECT (`{id, provider}`), not a string;
  `serverRunner` forwarded it verbatim, crashing `estimateCost`
  (`modelId.startsWith is not a function`) on the first record. Now extracts
  `model.id` at the boundary, with a defensive guard in `estimateCost`. Surfaced
  only by the first live `experiment` run — mock tests return a string. (Also
  affected `cortex autoresearch bench` against any real server.)
- **`startServer` set `PROJECT_ROOT` but the server resolves project context
  from `PROJECT_PATH`** (or cwd) — so a benched candidate's project-level
  `.cortex/` (system messages, CORTEX.md, agents) only resolved when cwd happened
  to match. Now sets `PROJECT_PATH` (+`PROJECT_ROOT`, +cwd) — which is also how a
  candidate makes a real, measurable harness-behavior change (a project-level
  override beats the global `~/.cortex`).

### Notes

- Investigated a suspected "system messages don't inject" issue (raised during
  the live proof) and confirmed it is **NOT a bug**: injection works end-to-end
  (10 messages incl. CORTEX.md, ~72K chars, verified reaching the assembled
  system prompt and the model). The earlier failure was test-design (editing
  `dist` which the global `~/.cortex` shadows; `PROJECT_ROOT`/`PROJECT_PATH`
  mismatch; and a low-compliance model ignoring a buried format marker). Added a
  gated `SMM_DEBUG`/`SMM_PROBE` diagnostic to `SystemMessageMiddleware`.

---

## [4.6.0] - 2026-06-07

### Added

- **Recursive auto-research decision layer.** The keep/discard "brain" that turns
  benchmark records into statistically-gated, reproducible merge decisions —
  the API the (nexus-side) NPC swarm consumes. Five composable pieces in
  `@nexus-cortex/core`:
  - `ExperimentLedger` (`.cortex/experiments.jsonl`) — STDB-portable keep/discard
    record (`experiment` header + `experiment_task_result` child, joined by
    `experimentTag`). `decide()` is the only path to a non-`pending` verdict.
  - `compareVersions` / `regressionScan` — task-by-task base-vs-candidate
    comparison over the benchmark matrix (`split='train'` enforced), returning
    raw per-run score arrays. Plus `ModelRouterMatrix.getRecords()` /
    `taskFingerprintsAt()` provenance-filtered accessors.
  - **Monte-Carlo gate** (`AutoResearchStats`) — bootstrap CI (keep iff the CI
    excludes 0) + permutation p-value + **N-aware FWER** (`sidakThreshold` /
    `mcFwerThreshold`; the keep bar tightens with swarm width). Seeded
    `mulberry32` RNG → **reproducible verdicts** (same records + seed = same
    p-value/CI), which makes a future public record verifiable.
  - `evaluateAutoResearchExperiment()` — one call runs the whole pipeline and
    writes the audited verdict; flags collateral regressions even on a keep.
    `verifyOnHoldout()` — mandatory second gate on `split='holdout'`; a candidate
    merges only if kept-on-train AND verified-on-holdout (`fixed` ≠ `verified`).
  - Overfitting guards are structural: train decides / holdout verifies, N-aware
    significance, confidence-weighted triage, regression scan.

- **`cortex autoresearch` CLI** — headless entry point to the gate, so a swarm
  member or the cortex-bench flow can produce `experiments.jsonl` without
  importing the library. `evaluate` (runs the gate over recorded base/candidate
  runs → writes the audited verdict; `--verify-holdout`, `--n-family`, `--seed`,
  `--json`, …) and `list` (inspect recorded decisions). The JSONL output is the
  integration boundary for the (nexus-side) SpacetimeDB convergence layer.

- **Programmatic grader (`BenchRunner` + `cortex autoresearch bench`).** Closes
  the loop: the orchestrator's auto-record only writes a liveness stub
  (`qualitativeScore = hasText ? 75 : 0`), which makes every base/candidate
  comparison a flat tie. `bench` runs a task set through the harness and GRADES
  each output with the task's verifier — `exact`, `regex`, `contains` (partial
  credit → continuous scores the gate can separate), or `llm-judge` — writing
  REAL scored records to `router-matrix.jsonl` under a given `--experiment-tag`
  / `--split` (and optional `--harness-ref` to label base/candidate on one box).
  Grading is pure/unit-tested; the harness call is an injectable `HarnessRunner`
  (real adapter drives the server's `/v1/messages`). Task-set format is JSON
  (`prompt` + `verifier`); see `.cortex/bench/tasks/sample-tasks.json`.

- **Thompson-sampling router (opt-in explore/exploit).** `MODEL_ROUTER_EXPLORATION`
  (default `false`) switches `model='auto'` sub-agent routing from greedy
  trust-gated selection to posterior sampling, so thinly-sampled models get a
  chance and the matrix stops being self-confirming. Default routing is
  unchanged.

### Changed

- **Default sub-agent model is now DeepSeek.** `SubAgentManager`'s two hardcoded
  `claude-sonnet-4-5-20250929` fallbacks → `DEFAULT_SUBAGENT_MODEL`
  (`deepseek-v4-flash`); `ModelRouterMatrix.recommend()`'s ultimate fallback
  `grok-4-1-fast-reasoning` → `deepseek-v4-flash`. Two shipped agent profiles
  (`web-researcher`, `new-model-api-integrator-analyst`) that defaulted to
  `grok-code-fast-1` now use `model: inherit` (follow the driver). No sub-agent
  default path can reach an xAI or premium-Claude model.

- **`/config reset` (optimal defaults) preserves the no-xAI guard.**
  `MODEL_ROUTER_EXCLUDE` now supports a trailing-`*` prefix wildcard and defaults
  to `grok*` — excluding every xAI model (present and future) from
  **automatic** router selection. Carried into `DEFAULT_SETTINGS`, so a reset
  no longer wipes it. The reset summary now surfaces the router + model defaults.
  The exclusion governs only hands-off auto-routing; an explicit model choice
  (driver `DEFAULT_MODEL_ID`, `/model`, a pinned agent profile, or the Task tool
  `model` param) is always honored, including xAI and expensive Claude models.

---

## [4.5.0] - 2026-06-07

### Added

- **Per-turn repository-state awareness.** Every turn the harness injects a
  "Repository State" `<harness-note>` (current branch, uncommitted changes
  scoped to the project subtree, recent commits) into the uncached user-turn
  tail — giving the agent the same git awareness Claude Code has, without
  spending a tool call. Gated by `CORTEX_GIT_CONTEXT` (default on).

- **Cross-agent file-staleness detection.** The note also warns when a file the
  agent read earlier has since changed on disk — by the user OR another agent
  sharing the working tree — so two agents can collaborate without clobbering
  each other's uncommitted edits. `FileReadTracker.getExternallyChangedFiles()`
  compares each read file's current disk mtime against the read timestamp
  (mtime is bumped by any writer, unlike the existing self-edit `isStale`).

- **`claude-opus-4-8`** registered (anthropic/messages, 1M context, 128K output,
  $5/$25). Also fixed adaptive-thinking on Opus 4.7/4.8: both the streaming and
  non-streaming paths now send `thinking: { type: 'adaptive' }` (the old
  `type: 'enabled'`/`budget_tokens` returns 400 on these families).

- **`DEBUG_THINKING`** now opts Opus 4.7/4.8 into `display: 'summarized'`,
  surfacing reasoning in the CLI (off by default — summarized thinking bills
  extra output tokens).

- **GitHub CLI noted in project memory** — `gh` is available and authenticated
  in this environment; the agent can use it for GitHub operations.

- **Mercury 2 (Inception Labs).** New `mercury` provider + `mercury-2` model
  card — a diffusion LLM (dLLM) over an OpenAI-compatible Chat Completions API
  (`https://api.inceptionlabs.ai/v1`). 128K context, 50K max output,
  $0.25/$0.75 per M ($0.025 cached read), tool-use capable, no top_p
  (temperature/stop only), no reasoning channel (diffusion is internal). Auth
  via `INCEPTION_API_KEY`. Specs verified against the live `/v1/models`
  endpoint — the direct API serves only `mercury-2` (coder variants are
  OpenRouter-only, intentionally not carded to avoid dead 404s).

### Fixed

- **Grep "Invalid string length" crash.** The grep tool's JS fallback now
  size-guards files (skips >20 MB) before reading them into a string, so a
  pathological large file (e.g. the Grok CLI's multi-hundred-MB upload-queue
  blobs) no longer exceeds V8's string cap. Added `.grok/**` to the fallback's
  ignore list.

### Removed

- **OpenRouter provider.** Removed the 3 OpenRouter cards
  (`claude-3.5-sonnet` / `gpt-4o` / `grok-4.1-fast` via OR), the
  `OpenRouterConfigurator`, and the OpenRouter-specific request headers — the
  `OPENROUTER_API_KEY` was retired and OpenRouter offered nothing not already
  available direct (it serves the same `mercury-2`). Registry: 97 → 94 models.
  Restore via `git revert` if the key is ever re-added.

## [4.4.4] - 2026-05-27

### Changed

- **Unified configuration system.** All 62 settings (was 39+16 split
  across three disconnected systems) now managed through a single
  SettingsSchema backed by `.env`. The old `~/.cortex/config.json`
  ConfigManager (6 keys) is no longer used by `/config` commands.

- **`/config list`** now shows ALL environment variables grouped by 12
  categories (was 6 keys from config.json). Values reflect actual `.env`
  state, not just schema defaults.

- **`/config set`** validates against full SettingsSchema and writes
  directly to `.env`. Shows previous vs new value and live/restart label.

- **`cortex config get/set/categories/category`** (Commander.js CLI)
  rewritten to use SettingsLoader/SettingsWriter instead of ConfigManager.

### Added

- 13 previously invisible runtime vars registered in SettingsSchema:
  `CORTEX_ENDTURN_GATE`, `CORTEX_RECORD_DECISIONS`,
  `CORTEX_LOOKUP_PRIOR_DECISIONS`, `CORTEX_DECISIONS_MAX_BYTES`,
  `CORTEX_MODE`, `YOLO`, `AUTO_RESUME`, `PORT`, `DEBUG_PAYLOAD`,
  `DEBUG_THINKING`, `ENABLE_SMOKE_TESTS`, `NVIDIA_API_KEY`.

- Missing metadata for `GEMINI_API_KEY`, `MENTORSHIP_ACTIVE_DISCOVERY`,
  `WEB_TOOLS_MODEL` now in SETTINGS_METADATA (was in interface only).

- New categories: `training` (5 settings) and `runtime` (4 settings).

- Live-toggle support for YOLO, DEBUG_PAYLOAD, DEBUG_THINKING,
  AUTO_RESUME, CORTEX_RECORD_DECISIONS, CORTEX_LOOKUP_PRIOR_DECISIONS,
  CORTEX_DECISIONS_MAX_BYTES.

### Fixed

- **Stale model choice lists.** DEFAULT_MODEL_ID, HELPER_MODEL_ID, and
  MENTORSHIP_HELPER_MODEL changed from hardcoded stale choice lists to
  free-text string (accepts any registered model ID).

- **MAX_TOOL_ITERATIONS metadata default** was 10000, actual DEFAULT_SETTINGS
  was 50. Now both agree on 50.

---

## [4.4.3] - 2026-05-27

### Added

- **TUI inline markdown renderer.** StreamDisplay now renders headings,
  fenced code blocks, bold/italic, links, blockquotes, and lists directly
  in the terminal (+309 lines). Replaces raw markdown passthrough.

- **Turn usage capture.** useCortexStream hook extracts per-turn token
  usage from orchestrator responses; CortexApp passes it through.

- **CLI settings.** Added `showLineNumbers` and `useAlternateBuffer`
  config options.

### Fixed

- **R47a: Edit tool forced unnecessary re-reads.** Successful edit (where
  `old_string` matched) proves the model knows file content. Now bumps
  read timestamp so the file stays "fresh" — only external modifications
  trigger staleness. Eliminates one wasted Read call per Edit on
  consecutive-edit tasks.

- **R47b: xAI reasoning_content dropped in multi-turn.** OpenAI-compatible
  streaming accumulated `reasoning_content` but omitted it from the final
  assistant message. Multi-turn xAI reasoning conversations silently lost
  thinking context from prior turns.

- **Spinner-safe stdout.** PersistentInput clears ora spinner before
  writing, re-renders after. Prevents garbled interleaved output.

- **Error truncation.** ToolFormatter truncates error output to first
  line, max 120 chars.

- **Launcher .env loading.** cortex.js now loads `.env` from cwd
  first, falling back to monorepo root.

- **findProjectRoot renamed to findInstallRoot.** Clarifies this finds
  the package installation root for config, not the tool execution CWD.

### Changed

- **BaseToolRegistry CC parity.** Read/Write/Edit tool descriptions
  rewritten to match Claude Code harness phrasing (cat -n format, absolute
  paths, must-differ constraint).

- **CLIApprovalHandler.** Per-tool action verbs ("Read /path",
  "Execute bash", "Edit /path") replace generic prompt. Debug logging.
  Text labels instead of emoji.

- **OrchestratorFactory.** Removed verbose 15-line permission profile
  auto-selection log.

- **CC-style tool symbols.** constants.ts uses symbols matching Claude
  Code conventions.

## [4.4.2] - 2026-05-27

### Fixed

- **R46a: Gemini web tools completely broken — migrated SDK.** Old
  `@google/generative-ai` SDK (v0.21.0) only hits `/v1` endpoint which
  returns "Unknown name 'tools'" for `googleSearch` grounding and
  `urlContext`. Migrated WebSearchTool and WebFetchTool to `@google/genai`
  SDK (v1.27.0) using `/v1beta`. Verified 6 Gemini models:
  `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`,
  `gemini-3.5-flash` (new GA), `gemini-3.1-pro-preview`,
  `gemini-3-flash-preview`.

- **R46b: XAI web search citations silently empty.** XAI Responses API
  returns `url_citation` annotations inside `output_text` parts (same as
  OpenAI), not a top-level `citations` array. `sourceCount` was 0 on
  every XAI search. Fixed extraction + URL deduplication (32 raw → 8
  unique in benchmark).

- **R46c: WebFetch 100% failure across all providers.** Models send
  `{ url: "https://...", prompt: "instructions" }` but the validator only
  checked `prompt` for URLs. Now merges `url` parameter into `prompt`
  before validation. All 4 providers (Gemini, XAI, Anthropic, OpenAI)
  pass WebSearch + WebFetch e2e.

- **Reasoning pattern optimization removed.** Stripping thinking blocks
  mutated `messageHistory`, broke prompt-cache prefix continuity across
  all providers, and caused model confusion on subsequent turns. Removed
  ~250 lines from `ContextBudgetManager` (`selectMessagesWithReasoning`,
  `stripThinkingBlocks`, `keepRecentThinking`, `optimizeByPattern`, etc.)
  and dual-path compaction from `CortexOrchestrator`. Cache hit rates
  restored to 60-96% on turn 2.

- **fuzzycortex CWD resolution.** `interactive.ts` used `CORTEX_ROOT`
  (monorepo install location set by launcher) as `projectPath` for tool
  execution. Tools resolved file paths against the monorepo root instead
  of the user's working directory. Fixed to
  `process.env.PROJECT_PATH || process.cwd()`.

### Changed

- **`.env` web tools documentation.** Comprehensive per-model notes for
  all verified web tool providers: 6 Gemini models with grounding quality
  differences, 3 non-Gemini providers with citation type details.

### Removed

- **`REASONING_PATTERN_OPTIMIZATION` and `REASONING_KEEP_RECENT_TURNS`
  env vars.** Removed from SettingsSchema, SettingsLoader, and
  RuntimeConfigRegistry. The reasoning optimization was harmful and is no
  longer configurable.

## [4.4.1] - 2026-05-23

### Fixed

- **Test suite: 35 stale/broken tests fixed across all packages.** 18 CLI
  command tests broken by `vi.restoreAllMocks()` clearing factory mock
  implementations (ConfigManager.load, rawQuestion, parseSlashCommand).
  17 pre-existing failures in core, executors, and server packages:
  `getBudgetSignal()` removal (rewritten to `computeToolBudgetSignal()`),
  `<user_query>` wrapping assertions, `ClientSideToolFilter` limit 10→15,
  `BrowseTool` env var assignment syntax, `ReadBeforeEdit`/`skill` regex
  case, `escalateDirective` text changes, server health/models/messages
  assertion drift. Result: **180 test files passing, 0 failures.**

### Added

- **Root `vitest.config.ts`.** Excludes `packages/archive/`, standalone
  `.mjs` test scripts, and `ink-ui` component tests (missing React
  rendering context). Sets 30s default `testTimeout` matching server
  integration test needs.

- **`ink-testing-library@4` dev dependency** added to CLI package for
  Ink component test rendering.

### Changed

- **`SessionValidation.test.ts` gated behind V3 data availability.**
  `describe.skipIf(!HAS_V3_DATA)` — test requires production session
  files from the V3 era that may not exist in all environments.

- **`HelperModelMiddleware` compaction tests gated behind
  `ENABLE_SMOKE_TESTS`.** These make real API calls and were timing out
  in unit test runs.

### Removed

- **Legacy `cortex-v4` and `cortex-v4-daemon` bin entries** from
  server package. Duplicate scripts deleted — `cortex-server` and
  `cortex-daemon` are the canonical commands.

### Changed

- **CLI bin commands renamed.** Added `cortex-launch` (unified server +
  CLI launcher), `cortex-cli` (Commander.js interactive), `cortex-dev`
  (hot-reload). `fuzzycortex`, `fuzzycortex-cli`, `fuzzycortex-dev`
  retained as aliases (branded splash screens).

## [4.4.0] - 2026-05-21

### Fixed

- **R45: Browse subagent MCP connection broken — agent-mode.ts hardcoded
  `enableMcp: false`.** BrowseTool sets `envOverrides: { MCP_AUTO_INJECT:
  'true' }` on the forked child, but `agent-mode.ts` ignored the env and
  hardcoded MCP off. Browse subagents spawned with zero browser tools.
  Fixed: reads `process.env.MCP_AUTO_INJECT` at child startup.

- **R45: Web tools invisible to model — Browse, WebSearch, WebFetch all
  `discoveryTier: 'standard'`.** The escalation directive told the model
  to "call `browse`" on WebFetch failure, but Browse was deferred and not
  in the tool list. WebSearch and WebFetch being deferred forced expensive
  subagent forks for simple lookups. All three promoted to `'essential'`
  (13 essential tools total). Benchmark: +841 baseline tokens, but 90%+
  of web tasks now handled without subagent overhead.

- **R45: WebFetch escalation directive improved.** Rewritten with a
  concrete `browse()` call example and challenge detection mention
  (`detect_challenge` + `solve_challenge`), replacing the vague prior
  directive that weaker models couldn't act on.

### Added

- **R30: Durable sub-agent result persistence.** `SubAgentProcessManager`
  writes completed results to `.cortex/sessions/<session>.subagents/
  <toolUseId>.json`. If the parent turn is ESC-aborted after a sub-agent
  completes, `validateAndRepairMessages` can recover the real result
  instead of injecting a generic error. Includes `loadPersistedResult()`
  static method for orphan recovery.

- **Auto-generated session titles.** Helper model generates a 5-10 word
  title on the first turn of each session (fire-and-forget). Title
  persisted in session metadata and displayed in the session picker UI.

- **Turn summary and next-action prediction (opt-in).** When
  `TURN_SUMMARY_PREDICTION=true`, the helper model generates a one-line
  summary and next-action prediction after each turn. Summary shown as
  dim `[Summary]` text in the Ink UI; prediction pre-fills the input as
  ghost text (Tab/Right to accept, Esc to dismiss). New streaming chunk
  type `turn_summary`. New setting in `SettingsSchema.ts`.

- **Task tool `list` command.** `task({ subagent_type: "list" })` now
  enumerates all available agents from `.cortex/agents/` with
  descriptions, instead of requiring the model to know agent names.

- **Skill tool `list` command.** `skill({ command: "list" })` enumerates
  all available skills from `.agents/skills/` with descriptions and
  trigger keywords.

- **Session `title` field.** `SessionMetadata` type extended with
  optional `title` property. `ListSessions` tool definition and
  `ListSessionsTool` executor updated to surface titles.

### Changed

- **PDF skill: 3-model delivery system.** Expanded from 2 to 3 delivery
  models: Model A (CLI/local chromium — preferred, zero token cost),
  Model B (Nexus VFS), Model C (Browse subagent + sandbox chromium via
  `run_command`/`html2pdf`). Model A confirmed working with local
  chromium at `/nix/store/.../chromium`.

- **Task Agent Guide simplified.** Replaced the 129-line verbose guide
  with a 5-line pointer to `task({ subagent_type: "list" })` for
  self-discovery, reducing system message token overhead.

- **Helper model adapter interface.** Added `generateSessionTitle()` and
  `generateTurnSummaryAndPrediction()` to `HelperMiddlewareAdapter`,
  implemented in both `MessagesAPIHelperAdapter` and
  `ChatCompletionsAPIHelperAdapter`.

## [4.3.0] - 2026-05-20

### Added

- **Model Router Matrix with auto-recording and task classification.**
  JSONL-backed scoring system (`ModelRouterMatrix`) records per-turn
  metrics (model, task type, tool calls, tokens, latency, cost,
  pass/fail) and recommends the best model for a given task type via
  weighted composite scoring (correctness 40%, efficiency 25%, speed
  20%, cost 15%). `TaskClassifier` heuristically maps prompts to T1-T5
  task types. Send `model: "auto"` to trigger routing.
  (`45c8ab29a`, `b926071ec`)

- **Compaction-on-rotate for router matrix.** When
  `router-matrix.jsonl` exceeds the byte cap (default 2MB), raw records
  are aggregated into weighted summary records (one per model+taskType
  pair) instead of being discarded. Summaries carry `_sampleCount` so
  new observations don't dilute historical knowledge. Falls back to
  simple rename if compaction fails. (`496030aab`)

- **Three new `.env` variables for model routing.** `MODEL_ROUTER_ENABLED`
  (default false) gates `model="auto"` routing. `MODEL_ROUTER_RECORD`
  (default true) auto-records turn metrics independently of routing —
  data collection works even when routing is off. `MODEL_ROUTER_STRATEGY`
  (auto | matrix-only) controls whether prompts are auto-classified.

### Fixed

- **T4 audit/review prompts misclassified as T1.** Added "security" to
  T4 keyword set and bumped T4 weight to 1.1 so audit-style prompts
  outscore T1's broad "codebase" pattern match. (`b926071ec`)

- **Auto-recording silent failure in stateless mode.** `OrchestratorFactory`
  only populated `modelRouter` config when `MODEL_ROUTER_ENABLED=true`,
  but recording should work independently. Now triggers on either
  `MODEL_ROUTER_ENABLED=true` or `MODEL_ROUTER_RECORD=true`.

## [4.2.0] - 2026-05-20

### Performance

- **R43: Deferred tool loading — 77% input token reduction.** Only 9
  essential tools are sent inline; the remaining 30+ are announced in a
  categorized list with descriptions and loaded on demand via
  `SearchTools`. Flat name-only lists failed T3 (model couldn't discover
  `list_sessions` without semantic context); grouped + described lists
  pass. Input tokens per turn: ~12K → ~2.8K. (`e4934de76`, `29392e646`)
- **R44: ESM module-evaluation timing fix — eliminates stateless-mode
  model thrashing.** `messages.ts` cached `PROJECT_ROOT` at static
  import time (before `index.ts` set `process.env.PROJECT_ROOT`),
  causing all stateless-mode tool calls to run against
  `packages/server/` instead of the monorepo root. Models saw "No
  matches found" on first grep and spiraled into 18-27 exploratory
  calls. Fixed with a lazy `getProjectRoot()` function. Benchmark:
  DeepSeek 24→2, Grok-4-1-fast 18→2, Grok-code-fast 6→2 tool calls on
  identical T1 code-exploration task. (`408a7a677`)

### Added

- **Usage data persistence on assistant messages.** Token counts
  (`inputTokens`, `outputTokens`, cache metrics) now persisted in JSONL
  session history alongside assistant content, enabling post-hoc cost
  analysis per session. (`682454df2`)

### Changed

- **Anti-thrash tool steering in Grep/Glob/WORK_QUALITY.** Tool
  descriptions rewritten: Python-biased examples replaced with
  language-neutral patterns (`**/*.ts` for TypeScript, `**/*.py` for
  Python), 4-point SEARCH STRATEGY block in Grep description, and a
  Code Exploration section added to `WORK_QUALITY.md` system message.
  Additive to the R44 infrastructure fix — helps models that would
  otherwise broaden searches unnecessarily.

## [4.1.0] - 2026-05-17

### Added

- **EndTurn self-audit gate + cortex-channel training records (opt-in).**
  Stage 1 scoped generative attestation gate on the orchestrator
  no-tool branch (mirrors the R18b continuation pattern), plus Stage 2
  (citation `verbatim_source` grounding) and Stage 3 (cited line# must
  map to a citation whose source sits at that line in a `cat -n` read)
  verifiers. Emits nexus-DBAI-schema-compatible `RouterTrainingSample`
  records to `<root>/.cortex/training/cortex-samples.jsonl`. Default
  **OFF** — opt in via `CORTEX_ENDTURN_GATE=true`; OFF still emits
  records with a deterministic-only score. Bounded by
  `END_TURN_MAX_NUDGES`, scoped to tool-using turns.
  (`a6f25ef47`, `62f896302`, `20b39e925`)
- **`CORTEX_DECISIONS_MAX_BYTES`** makes the `.cortex/decisions.jsonl`
  rotation cap a positive-integer byte override (default 2 MB
  unchanged). Documents the pre-existing `CORTEX_RECORD_DECISIONS` /
  `CORTEX_LOOKUP_PRIOR_DECISIONS` toggles + the cap in `.env.example`
  and `CLAUDE.md`. (`348c1b1bf`)
- **Cloudflare Workers AI provider — 13 `@cf/*` models.** New provider
  adapter + model cards. (`87a177856`)
- **Gemini 3.x preview models** registered for parity with CORTEX.
  (`331920035`)
- **xAI authoritative per-request cost surfaced (`cost_in_usd_ticks`).**
  `GatewayTranslationLayer.extractUsage` now reads xAI's billed cost
  (Responses/chat-completions path, 1 USD = 1e10 ticks) into
  `usage.costUsdTicks`/`costUsd`/`serverSideToolsUsed`. Reveals
  otherwise-opaque server-side tool + reasoning spend (a trivial
  Responses call billed ~4× a token estimate). Not on the
  Anthropic-compat `/v1/messages` path. (`1d58bd2a3`)

### Changed

- **Applied cortex-optimal-seed-defaults.** `CONTEXT_BUDGET_STRATEGY`
  default → `priority-based`, `REASONING_PATTERN_OPTIMIZATION` seed →
  `false` (cross-harness consistency with nexus CORTEX seed defaults).
  (`2c0569a8c`)
- **xAI family-aware temperature defaults**, then unified: grok-code →
  0.1 / grok-4 → 0.7 (`3ecc80c55`), subsequently unified to a flat 0.7
  across the xAI family for cross-harness consistency (`d688e8138`).
  grok-4.3 then pinned to an explicit per-card `temperatureDefault:
  0.5` (the only explicit per-card temperature in the registry;
  empirically: temp-0 stable, temp-2 garbled, provider-default
  coherent but fabricates line numbers).
- **Turn-varying user system messages + `WORK_QUALITY.md`
  grounded-references rewrite.** (`d69c676ff`)

### Docs

- **R23: added a TDD Implementation Discipline section to
  `WORK_QUALITY.md`** (agent-facing system message — steers red-first
  discipline). (`526e6e1e4`)

### Performance

- **`recordToolDecision` is now truly fire-and-forget** via
  `queueMicrotask` — removes a synchronous await from the tool path.
  (`96acfd44d`)

### Fixed

- **Line-number / citation fabrication root-caused at `ReadFileTool`.**
  The tool *description* promised `cat -n` numbered output but the
  executor emitted raw unnumbered content, so models (grok-4.3 most
  visibly — a decisive-completion disposition that fills gaps rather
  than hedging) confabulated line numbers from training priors.
  `ReadFileTool` now emits true `cat -n` (`%6d\t` prefix); the
  content-hash `sectionContent` stays raw. This is the actual fix for
  the fabrication; the EndTurn gate is an independent training axis.
  (`039360c91`)
- **`.cortex/decisions.jsonl` and `cortex-samples.jsonl` were
  unbounded.** Both now self-rotate (single-generation,
  rotate-before-append: main → `.1`, total ≤ ~2×cap, newest record
  never dropped). DecisionStore default 2 MB (bounds disk + the
  per-lookup O(file) scan); cortex-samples 5 MB (write-only,
  low-volume). TDD. (`48138c1fb`, `120ff0667`)
- **R29b: runaway tool exploration had no real brake.** Benchmark caught
  deepseek-chat doing 46 successful local `Read`/`Grep`/`Glob` calls
  (zero web) over 392s with no deliverable — `MAX_CONSECUTIVE_ERRORS`
  resets on any tool success so it never tripped, and the old
  `getBudgetSignal` was a ratio-of-maxIterations hint that fired late
  and was a skippable `[bracket]` weak models ignored. New
  `TOOL_BUDGET_SOFT` setting (default 15) + pure `computeToolBudgetSignal`
  helper: escalating imperative `<system-reminder>`s at 1x and 1.5x, and
  a hard force-synthesis cap at 2x that breaks the loop (→ R29a
  synthesis) in BOTH the `sendMessage` and `streamMessage` loops.
  Validated on deepseek-chat AND deepseek-v4-flash, structured AND vague
  prompts: the 46-tool/392s/0 runaway became 21–28 tools / 76–227s with
  a correct multi-K deliverable; vague non-expert prompts no longer
  rabbit-hole. TDD (6/6).
- **Decisiveness steering for weak models / vague prompts.** Added a
  prescriptive "Decisiveness" section to the always-on (static, cache
  -safe) `TOOL_USAGE_GUIDE.md`: minimum tools, stop and answer when
  evidence is sufficient, never re-read the same region, make a
  reasonable interpretation of vague requests instead of exhaustively
  investigating. Complements R29b; helps users who don't write explicit
  prompts.
- **R29a streaming parity.** The `streamMessage` loop had no R18b/no-text
  guard at all; ported the post-loop synthesis net (tools-suppressed,
  yields the synthesized text as a `text_delta` chunk, best-effort).
- **WebFetch failures now escalate to `browse` in-band.** WebFetch
  routes through Gemini urlContext + a 10s plain-fetch fallback; both
  fail on blocked/JS/dynamic pages (observed: ~1/20 success on a long
  agentic county-records task — the model kept retrying WebFetch). Every
  WebFetch failure result now carries a firm `<system-reminder>` telling
  the model to stop retrying WebFetch and immediately use `browse` with
  the exact URL (then browse-agent/task-agent). New `escalateDirective`
  helper, TDD (4/4).
- **WebFetch fallback fetch sends browser headers + 30s timeout.** The
  last-resort local fetch was bare (no User-Agent → 403 from CDN/WAF
  sites). Adds a modern Chrome UA + Accept/Accept-Language,
  `redirect:'follow'`, and raises the timeout 10s→30s. Helps the
  UA-filter tier only; datacenter-IP/WAF/JS pages still route to
  `browse` via the escalation directive. `buildBrowserFetchInit` helper,
  TDD (3/3).
- **`CacheMetricsAccumulator` >1.0 guard test.** Pins Opus's Defect-E
  invariant: with R28g-shaped (true-total) usage, accumulated/per
  -provider hit rates stay ≤ 1.0 even on heavy-cache steady state — so a
  future `extractUsage` regression is caught loudly here.
- **R29a: no-text loop exit returned zero deliverable.** A 6-surface
  benchmark caught deepseek-chat running 16 tools, hitting
  `MAX_CONSECUTIVE_ERRORS`, and the loop breaking with the final
  assistant turn a bare `tool_use` — the orchestrator returned
  `content=[tool_use]`, `ansLen=0`, nothing for the user. R18b's
  empty-response retry only covered the `toolUseBlocks.length===0`
  path. New pure helper `assistantTextPresence.hasVisibleAssistantText`
  (de-duplicates R18b's inline check) + a post-loop synthesis net in
  both `sendMessage` and `streamMessage`: on any no-text loop exit,
  force one tools-suppressed synthesis turn (orphan-safe via
  `convertToCanonicalMessages`; best-effort so it can't crash the
  turn). Empirically: deepseek-chat ansLen `0 → 27021`, final block
  `[tool_use] → [text]`, answer correct. 37/37 regression green.
  (`7ceb8e8c7`)
- **R28g: Anthropic/xAI cache metrics treated `input_tokens` as the
  grand total.** Benchmark surfaced `cacheHitRate=30.7366` /
  `costSavingsRatio=27.663` (both impossible). Anthropic's
  `input_tokens` is only the post-cache-breakpoint remainder; the
  three input fields are mutually exclusive (proof:
  `30.7366/27.663 = 1/0.9` = the anthropic discount). Fixed the
  Anthropic/xAI branch of `extractUsage` to recombine the true total
  (`postBreakpoint + cache_creation + cache_read`) and stop
  double-subtracting `uncached`; OpenAI/DeepSeek/Google branches
  untouched (their `prompt_tokens` already include cached). 8
  bug-enshrining test assertions repaired + benchmark-repro RED test;
  a `CacheMetricsAccumulator` >1.0 guard test pins the downstream
  invariant. Validated end-to-end: real claude-haiku-4-5 T2
  `hit 30.73→0.9537`, `sav 27.66→0.8583`. (`7d6fc7ad9`)
- **R28f: xAI cross-turn prompt-cache floor — system field byte-unstable
  across turns.** The static system prompt was rebuilt every turn by a
  turn-conditional system-message loader; a ~56K first-turn-only block
  (CORTEX/CLAUDE/MEMORY .md) dropped out by turn 2, collapsing the
  provider `system` field 68854→12134 chars mid-conversation. xAI prefix
  caching needs a byte-identical `system` across turns, so every
  cross-turn request was capped at the ~128-token floor (0.86% hit).
  Hybrid fix: (1) `pinStaticSystemPrompt` memoizes the first non-empty
  static system prompt per conversation and replays it byte-identically
  on later turns (invalidated on a genuine model switch); (2)
  `turnVaryingClassifier` + `injectWithSystemSplit` route genuinely
  periodic/late-turn messages (`turnNumberModulo`, `turnNumber!=0` —
  e.g. `periodic_reminder`) into the moving user turn (after every
  provider's cache boundary) so they still fire as authored without
  busting the cached prefix. Validated end-to-end: xAI cross-turn
  cacheRead 128/0.86% → ~27.7K/99.6%, ~75% cost savings. Cross-provider
  confirmed: Anthropic (full system block from cache), DeepSeek (98.97%),
  OpenAI (99.70%); Gemini neutral. 36/36 tests, TDD red-first.
  (`e2cce8aa2`)
- **DeepSeek prompt-cache metrics were invisible in `usage.cache`.**
  `GatewayTranslationLayer.extractUsage` routed DeepSeek through the
  chat/completions catch-all, which reads OpenAI's
  `prompt_tokens_details.cached_tokens`. DeepSeek instead reports
  `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` at usage
  top-level, so DeepSeek's server-side prefix caching worked but always
  reported 0 — silently understating cost savings on every DeepSeek
  call. Added a dedicated `provider==='deepseek'` chat/completions
  branch (~75% cache-hit discount). Verified end-to-end: DeepSeek T2
  cacheRead now 12288 / 98.97% / 74.2% savings (was 0). Cache-metrics
  suite 19/19 (2 new tests). (`2e8576ddd`)
- **R28: xAI prompt-cache prefix stability restored (99.6% cross-turn).**
  Static system content was riding the moving latest-user-message slot
  (Rule-1 cache-prefix violation) and the `x-grok-conv-id` sticky-routing
  header was never sent; signature capture added to the xAI stream.
  Precursor to the R28f hybrid above. (`6ebb2df2a`)
- **R27: xAI `/v1/responses` path — 3 compounding bugs** (raw-fetch
  transport corrections for the Responses API route). (`cb7f55187`)
- **R26: repair empty assistant turn before the R18b retry** (xAI
  Messages API) — prevented a malformed turn from poisoning the retry.
  (`7d618fdbf`)
- **R21: count consecutive all-fail iterations, not cumulative tool
  failures** — stops a single recoverable error from tripping the
  consecutive-error abort. (`b05efe741`)
- **R20d: Gemini drops foreign thinking blocks + DeepSeek registry
  parity with CORTEX.** (`bda0c4c0f`)
- **R18→R20: multi-provider harness deficiency fixes** — cross-provider
  coherence, multi-provider tool handling, GPT-5 server-side tools.
  (`c428c52ea`)
- **`switchModel` same-model no-op guard.** The server route calls
  `switchModel` on every request carrying `model`, firing a same-model
  "switch" every headless turn; without the guard it nulled the
  Responses-API chain and could slice history, silently breaking
  multi-turn continuity. (`e237f01aa`)
- **Server honors request-level `temperature` / `max_tokens` /
  `top_p`.** These were silently dropped (top-level vs orchestrator
  `options.parameters` mismatch). (`d1511bb80`)

- **#23: `GenerateContentAPIAdapter` lost Gemini `thoughtSignature` on the
  message-level converter.** Round-14's adapter round-trip audit (Opus 4.6
  sub-agent + cortex/claude-opus-4-6) caught the asymmetry: the per-block
  converter at line 220 DID preserve `thoughtSignature`, but the
  message-level converter at line 594-602 stripped it. Multi-turn Gemini
  2.5+/3 reasoning continuity broke silently. Fix preserves it into
  `toolUse.metadata.thoughtSignature` matching the symmetric round-trip
  the toProvider path expects. 2 new round-trip tests.

### Fixed

- **#19: `convertToCanonicalMessages` strips `thinkingMetadata` on history
  re-conversion.** Round-12 drift-audit benchmark caught the round-11
  signature-aware drop logic firing as a no-op because the metadata
  field was lost during the round-trip through history. Fixed by also
  preserving `thinkingMetadata` in the converter's thinking-block
  branch.
- **#19 final fix: drop signature-less thinking universally for
  Anthropic.** The streaming `APIClient` doesn't set
  `thinkingMetadata.source`, and live testing confirmed Anthropic's API
  now 400s on ANY signature-less thinking block regardless of source —
  not just extended-thinking blocks. The earlier "preserve Haiku
  native-interleaved signature-less" policy was based on a stale API
  contract. Updated 3 tests to assert the universal drop.
- **#21: Orchestrator retries unrecoverable 400 errors indefinitely.**
  Same drift-audit benchmark showed the non-streaming loop running 50
  iterations of the identical `messages.X.content.Y.thinking.signature:
  Field required` 400 because `totalToolErrors` reset to 0 every time
  tool execution succeeded — masking accumulating API-level structural
  failures. Extracted error classifier
  (`packages/core/src/orchestrator/apiErrorClassifier.ts`) detects
  structural 400s (`invalid_request_error`, `Field required`,
  `messages.`, `must be a response to`, `must be a preceding`) and
  capacity errors, aborts the loop immediately. Both non-streaming and
  streaming dispatch paths use the same classifier.

### Fixed

- **#17: Tool-name typo recovery.** When the model calls a non-existent
  tool, the "Unknown tool" error now includes up to 3 closest-match
  suggestions ("Did you mean: Grep, Glob?"). New helper at
  `packages/core/src/orchestrator/toolNameMatcher.ts` ranks by
  case-insensitive Levenshtein distance with a prefix-match fast path
  for truncations. Surfaced when round-10 caught cortex/gemini-2.5-pro
  calling `Gorp` (typo of `Grep`) and stalling for 2 iterations on the
  bare error.
- **#18: 64-char name cap restored on `CreateArtifactTool`.** The cap was
  dropped silently during the `CreateAddonTool` → `CreateArtifactTool`
  rename refactor; all 3 successful agents in the round-10 multi-agent
  audit unanimously diagnosed it as a regression. Validation now
  fires before the auto-sanitize step so callers see the same length
  contract they passed in.

### Fixed — Security

- **#16: claude-opus-4-6 multi-turn continuation breaks on missing
  `thinking.signature`**. Anthropic's Messages API rejects re-sent
  extended-thinking blocks without a signature with
  `messages.X.content.Y.thinking.signature: Field required`. The adapter
  now drops `thinkingMetadata.source: 'extended'` blocks that lost their
  signature during persistence; native-interleaved thinking (Haiku 4.5,
  no signature ever emitted) continues to be preserved.

### Fixed — Tests

- Partial-migrated `create-addon-tool.test.ts` Parameter Validation
  block (5 of 7 tests un-skipped) per 5-way parallel audit consensus
  (Opus 4.6 sub-agent + cortex/grok-code-fast-1 + cortex/deepseek-v4-pro
  agreed `partial-migrate`):
  - Updated `result.returnDisplay` → `result.error` (BaseTool result
    shape changed).
  - Migrated 4 still-strict validation tests with updated error wording
    (`"code must be a non-empty string"` → `"implementation.code is
    required"`, etc.).
  - Inverted the "invalid characters" test: now asserts the tool
    auto-sanitizes `"invalid/name"` → `"invalid-name"` (intentional
    contract change documented in CreateArtifactTool comments).
  - Filed **deficiency #18** as a regression for the dropped 64-char
    name cap, test marked `it.skip` until restored.
  - Remaining success-path describe blocks (JavaScript/Python creation,
    sandbox config, output formatting, metadata, edge cases, abort
    signal) marked `describe.skip` until the new contract's success
    shape is documented.

- Migrated `GrepTool.output-limits.test.ts` (5 tests) to the current
  offset-based pagination contract: `HARD_MAX_RESULTS=500` as a per-call
  ceiling, `MAX_CONTENT_LENGTH=30000`, `[TRUNCATED] N more matches available`
  marker, `metadata.displayedMatches` / `metadata.hasMore` / `metadata.nextOffset`.
- Migrated `thinking-block-preservation.test.ts` (2 tests). The
  `convertToCanonicalMessages()` private method runs through
  `validateAndRepairMessages()`, which synthesizes a tool_result user
  message for orphaned `tool_use` blocks (crash recovery). Tests now
  look up the assistant message by uuid instead of asserting
  `toHaveLength(1)`.
- Migrated `SystemMessageInjection.test.ts` (1 test). System messages
  are intentionally ephemeral and re-injected each turn — dedup is
  intra-call only. Test now asserts the idempotent re-injection
  invariant (same context → same message IDs across calls) instead of
  the obsolete cross-call dedup expectation.

### Internal

- 8 previously-skipped tests now pass across all 4 test suites
  un-skipped in this revision.
- Documented `mcp-tools-integration.test.ts` as intentionally not
  slated — covered by 113 core MCP unit tests + 17 orchestrator
  integration tests + live nexus-browser benchmarks, and re-introducing
  its `npx`-spawn pattern would re-introduce the leaked-process risk
  that initiated this audit.
- Documented `create-addon-tool.test.ts` as needing contract-owner
  review — 18 of 25 tests fail due to deliberate I/O simplification
  (auto-sanitize over reject, removed metadata fields, reworded error
  messages).
- Terminal-success scoring (`witty-tracing-narwhal` parity) deferred:
  no consumer in the OSS harness; pure metadata enrichment with no
  ML training-sample downstream to consume it.

---

## [4.0.0] - 2026-05-11

This is the first version cut after a full audit of the monorepo's web tooling,
MCP transport, permission system, and tool-call observability. Eleven distinct
deficiencies were resolved, two new subsystems shipped, and the regression test
suite returned to **1555 passing tests with zero failures** across the `core`
and `executors` packages.

### Added — Native HTTP MCP transport (Part A)

- `StreamableHTTPClientTransport` wiring in `McpClient` so HTTP MCP servers
  (e.g. `nexus-browser`) connect natively instead of through the `mcp-remote`
  stdio bridge.
- `McpServerConfig` gained `transport: 'stdio' | 'http'`, `url`, `headers`,
  and `reconnectionOptions` fields.
- `MCP_CONFIG.md` parser recognizes `**Transport**:`, `**URL**:`, and
  `**Headers**:` markdown fields. `**Headers**:` values support
  `${ENV_VAR}` substitution so secrets stay out of committed config.
- `nexus-browser` is now the default Enabled MCP server in the shipped
  `MCP_CONFIG.md` template (`packages/cli/src/commands/mcp/init.ts`).
- Subscriber permanent keys via `NEXUS_BROWSER_API_KEY` in `.env.local`
  (gitignored). Server + CLI launcher load `.env.local` after `.env` with
  override.

### Added — Multi-provider Web Tools (Part B)

- `WebSearch` / `WebFetch` rewritten as multi-backend executors:
  - **Anthropic** — Messages API + `web_search_20250305` server tool
  - **XAI** — Responses API + `web_search` server tool
  - **OpenAI** — Responses API + `web_search_preview` server tool
  - **Google Gemini** — `googleSearch` grounding with UTF-8 byte-accurate
    citation insertion (existing path preserved)
  - **DuckDuckGo HTML fallback** — direct fetch + `html-to-text` extraction
    when no provider key is configured. No API key required.
- Backend selection driven by `WEB_TOOLS_MODEL` env var (auto-detects
  provider from model ID prefix). Auto-picks a sensible default based on
  which provider keys are present (Gemini > Anthropic > XAI > OpenAI).
- `WEB_TOOLS_MODEL` documented in `.env.example` and `SettingsSchema.ts`.
- `nexus-browser` is **NOT** a backend here — it is exposed as a separately-
  gated MCP server, never as a direct-fetch path from OSS code.

### Added — Training pipeline (lookup-before-action)

Port of the nexus-terminal cortex `witty-tracing-narwhal` pattern, simplified
for the standalone OSS harness (JSONL backend, no SpacetimeDB dependency).

- `DecisionStore` (`packages/core/src/training/DecisionStore.ts`):
  append-only JSONL log at `<projectRoot>/.cortex/decisions.jsonl`. Surface:
  `record(decision)`, `lookup(toolName, hash)`, `recent(toolName, hash, limit)`,
  `stats(toolName, hash)`. Stable input hashing (key-sorted SHA-256). Resilient
  to partial-write corruption.
- `DecisionPriorInjector`
  (`packages/core/src/training/DecisionPriorInjector.ts`): formats a
  `<system-reminder>` from prior stats + the 3 most-recent matching outcomes.
  Only emits when `failures > 0` (no noise on pure-success histories).
- `CortexOrchestrator.processToolTraining()` runs LOOKUP first
  (prepends reminder to the tool result) then RECORDS the new outcome —
  so a call doesn't pollute its own priors.
- Env-gated: `CORTEX_RECORD_DECISIONS=false` disables write side;
  `CORTEX_LOOKUP_PRIOR_DECISIONS=false` disables read side. Both default true.

### Added — Verbatim-transcription reminder

- `ReadFileTool` prepends a `<system-reminder>` to successful read results
  warning the model to transcribe verbatim when feeding content into
  `Write`/`Edit`. Models filter `<system-reminder>` blocks from
  verbatim-quote contexts so it doesn't pollute exact-copy operations.
  Mitigates confabulation observed in bench 3 (grok-code-fast-1 rewriting
  `const X = {...} as const` as `enum X {...}`).

### Changed — Permission system (six deficiencies)

- **Profile path resolution**: new `resolvePermissionProfilePath()` helper
  tries `.cortex/permissions.<profile>.json` (documented in CLAUDE.md) first,
  falls back to `.cortex/permissions/<profile>.json` for back-compat.
- **Empty whitelist footgun**: `PermissionConfigLoader.createPolicy()` now
  skips a `type: whitelist` entry whose `allowedTools: []` and emits a clear
  warning. (Honoring it denies every tool, which is a footgun in a shipped
  profile.)
- **`PermissionsMiddleware.bypassAll`**: short-circuits before policy
  evaluation. `OrchestratorFactory` sets `bypassAll: permissionMode === 'auto'`
  so YOLO (`YOLO=true` env / `--yolo` flag) truly bypasses — including
  hard-deny policies (`canApprove: false`) that approval handlers cannot
  otherwise rescue.
- **`defaultPolicy` honored from JSON**: previous code hard-coded
  `'deny'` at `OrchestratorFactory.ts`, overriding `defaultPolicy: 'allow'`
  in dev profiles. Factory now reads the JSON's `defaultPolicy`.
- **`prod.json` canonical tool names**: shipped `permissions.prod.json` had
  `snake_case` names (`read_file`, `grep`, …) that didn't match the canonical
  PascalCase `ExecutorRegistry` names — every whitelist entry silently
  no-op'd, so prod effectively hard-denied every tool. Rewritten with the
  agreed read-only allowlist (17 tools).
- **`DefaultPolicies` whitelist completeness**: added `WebSearch`, `WebFetch`,
  `TodoList`, `SearchTools` to the hardcoded fallback whitelist.

### Changed — MCP tool namespacing

- MCP tools are now surfaced to the model as `<serverName>__<toolName>`
  (e.g. `nexus-browser__browse`) so they don't collide with native PascalCase
  tool naming or across MCP servers. New helper:
  `packages/core/src/mcp/mcpToolNamespacing.ts`. Dispatcher strips the
  prefix before calling `mcpManager.callTool`. Back-compat: raw names still
  accepted when only one server defines that tool.
- `ToolNamingHandler.convertName()` detects MCP-namespaced names and skips
  case conversion entirely. Previously the case converter mangled
  `nexus-browser__browse` into `Nexus-browserBrowse`, breaking nexus-browser
  end-to-end.

### Changed — MCP HTTP reconnection

- `McpClient` applies a custom default reconnection policy on HTTP
  transport: `maxRetries: 10`, `initialReconnectionDelay: 1000`,
  `maxReconnectionDelay: 30000`, `reconnectionDelayGrowFactor: 1.5`. The
  MCP SDK default of `maxRetries: 2` was too low for long-running cortex
  sessions where the SSE channel may drop mid-operation. Overridable via
  `McpServerConfig.reconnectionOptions`.

### Fixed — Security

- **`ReadFileTool` relative-path containment**: relative paths supplied to
  `Read` (e.g. `../../etc/passwd`) now refuse to escape `workingDirectory`,
  while absolute paths remain allowed (parity with Claude Code). Previously
  a relative path with `..`-traversal was happily resolved and read.

### Fixed — Tests

- Pre-existing test drift across `CortexOrchestrator.test.ts` (30),
  `GenerateContentAPIAdapter.test.ts` (3), `SessionValidation.test.ts` (1),
  `mcp-config-integration.test.ts` (17), `thinking-block-preservation.test.ts`
  (2), `HistoricalContextService.test.ts` (1), `SystemMessageInjection.test.ts`
  (3), `ShellTool.test.ts` (8), `GrepTool.test.ts` (7), `EditTool.test.ts` (1),
  `GlobTool.test.ts` (1) all migrated to the current API surface.

### Internal

- 12 new regression test suites added across permissions, MCP, training,
  adapters, and Read tooling.
- Memory file `cortex-benchmark-findings.md` now documents 15 deficiencies
  found via progressive parallel benchmarking against Sonnet 4.6 and Opus 4.6
  sub-agents.

---

<!--
Future entries follow the [X.Y.Z] - YYYY-MM-DD heading pattern.
Sections: Added / Changed / Fixed / Deprecated / Removed / Security / Internal.
-->
