# Changelog

All notable changes to Nexus Cortex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.91.0] - 2026-09-03

### Added
- **EndTurn gates on the streaming path.** Stages 2/4/5, the effort tail and the Stage-1 missing-EndTurn nudge now
  run for streaming clients too, from one shared, exception-safe implementation (`endTurnGates.ts`).
- **`VISION_HANDOFF_MAX`** (default 8): per-turn cap on ReadImage→vision-helper hand-offs; a capped read returns a
  consolidate-into-one-montage reminder and banks a `vision_handoff_capped` event.
- **`CORTEX_SLICE_NUDGE`** (default on): after the third bash slice-read of the same file, a one-line reminder to read
  it once with Read (`slice_read` steering event).

### Fixed
- The tool loops never re-execute an already-run batch when an exception escapes after execution (both loops;
  regression test through the real loop).
- Citation grounding accepts text the model authored this turn (Write/Edit content); strict `verified_how` accepts a
  command that actually ran this turn.

### Changed
- Vision helper framing transcribes boards, grids, tables and figures cell by cell / panel by panel.

## [4.90.2] - 2026-09-03

### Fixed
- EndTurn gate evaluation is exception-safe: a gate fault becomes an error EndTurn result instead of escaping to the
  tool loop, which re-executed the already-run batch without a model call.

### Changed
- Stage-2 citation nudge explains per-turn grounding and asks the model to re-run the displaying command for a fresh
  verbatim line; EndTurn description carries a worked requirements example; ReadImage guidance adds read discipline
  (one focused question per call; tile boards and grids into labeled cells).

## [4.90.1] - 2026-09-03

### Fixed
- **`TOOL_TIMEOUT_MODE=auto` never promoted** in 4.90.0: the orchestrator's outer tool-abort fired at the same
  instant as ShellTool's promote deadline and won, so long Bash calls were still cancelled. The outer cap now
  fires 30s after the tool's own deadline, and ShellTool's default deadline follows `TOOL_TIMEOUT_MS`.
- **`CORTEX_ENDTURN_REQUIREMENTS=strict` threw on `EndTurn({})`** (null requirements). Strict also now accepts
  honestly condensed requirements (24-char verbatim window or ≥70% of the task's content tokens) and its
  grounding nudge shows a concrete pasted-output example.

## [4.90.0] - 2026-09-02

### Added
- **Vision hand-off for text-only models** (`VISION_HELPER_MODEL`, default `deepseek-v4-flash-vision-exp`):
  ReadImage is offered to text primaries; the orchestrator sends the image + the caller's `prompt` to the
  vision card through the helper middleware and returns text. Banks a `vision_handoff` steering event.
- **`TOOL_TIMEOUT_MODE=auto|kill|background`** (promote-at-deadline): headless/auto-approve sessions no
  longer kill a Bash call at `TOOL_TIMEOUT_MS` — it moves to the background registry and returns
  "STILL RUNNING … bash_id" (BashOutput/KillShell). Interactive keeps the kill. `tool_promoted` event.
- **`CORTEX_ENDTURN_REQUIREMENTS=strict`**: Stage-4 additionally requires verbatim task clauses as
  requirements and a `verified_how` grounded in an executed check's output this turn.
- Shipped `.cortex/orient` prints a one-line tooling inventory (interpreters, venvs, common binaries).

### Changed
- `CORTEX_CLIENT_FETCH_TIMEOUT_MS` template default 3600000 → 12600000 (caps sit above the longest
  legitimate unit of work; the old value was a latent self-cut on 1-3.3h headless tasks).
- `.env.example` lever ledger updated with the c3 / p3 / timeout-audit verdicts; `CORTEX_IDLE_TIMEOUT`
  documented as dead (no code reads it).

## [4.77.0] - 2026-08-26

### Added
- **Near-duplicate call breaker** (`CORTEX_NEARDUP_BREAKER=true`): detects minor-variation
  command loops (changed filenames, pids, counters) that slip past exact-repeat and poll
  detection — one guidance nudge at N recurrences in a sliding window, graceful break at 2N.

### Fixed
- Shell cancellations no longer report "cancelled by user" when the cause was a timeout —
  the message now states the truth ("timed out or aborted").

## [4.76.2] - 2026-08-26

### Fixed
- **BashOutput no longer refuses oversized background logs**: results past the size cap return
  the tail with a truncation notice (a background stream's tail is the answer; the old refusal
  offered navigation advice BashOutput has no parameters for, and cost a model its own training
  results in live testing).

## [4.76.1] - 2026-08-26

### Fixed
- Surrender-guard detection covers three additional live-observed surrender phrasings from the
  first specimen reruns; plain successful answers remain untrippable.

## [4.76.0] - 2026-08-26

### Added
- **Surrender guard** (`CORTEX_SURRENDER_NUDGE=true`): when a turn ends by listing remaining
  steps instead of executing them — an honest status report with a self-written recovery plan
  and budget left on the table — the model gets one bounded "execute your plan" nudge before
  the turn is accepted.

### Fixed
- **Abnormal exits no longer silently bypass the EndTurn gate**: the forced post-loop synthesis
  path now records un-attested passes, and its reminder demands a requirements enumeration
  (satisfied-and-verified vs not) so honest incompleteness stays honest.
- **Tool-diversity warning spam**: fires once per threshold crossing (10, 20, 40…) instead of
  every iteration; under narrow bash frames the Bash threshold starts at 30 (heavy bash usage
  is the norm when bash is the whole tool surface).

## [4.75.1] - 2026-08-26

### Fixed
- **Browse included in the integrity schema**: browser-driven page retrieval now triggers the
  sources attestation, feeds the transplant check, and carries the task-integrity description
  clause — previously the richest retrieval channel bypassed all Stage-5 evidence.

## [4.75.1] - 2026-08-26

### Fixed
- **Browse included in the Stage-5 integrity schema**: the headless-browser tool now triggers
  the sources attestation and feeds the transplant/solution-query checks like WebSearch and
  WebFetch — previously it was an uncovered retrieval channel. Same justify-don't-block
  semantics; legitimate interactive research is untouched.

## [4.75.0] - 2026-08-26

### Added
- **EndTurn Stage-5 integrity verifier** (`CORTEX_ENDTURN_INTEGRITY=true`): before a turn can
  complete, the gate mechanically checks the turn's own evidence — fetched-web-content
  transplanted into artifacts, solution-seeking queries — and requires a **show-your-work
  `sources` attestation** whenever web tools were used ({accessed, purpose, used_for} per
  access; new optional EndTurn field). **Justify, don't block**: mechanical findings are
  audit events when an honest attestation is present — legitimate documentation research and
  repository archaeology are never penalized; only unattested web usage draws a bounded nudge.

## [4.74.1] - 2026-08-26

### Fixed
- **Loop-kill false positives on legitimate repeats**: `MAX_LOOP_REPETITIONS` now counts
  CONSECUTIVE byte-identical calls only. Previously it counted occurrences across the whole
  turn, so a legitimate verify cycle (the same `npm test` after each of several fixes) was
  killed as an infinite loop with corrupted turn metrics. Uninterrupted identical spam — the
  guard's actual target — still trips at the same threshold, and the busy-wait poll guard's
  soft nudge now layers cleanly beneath it.

## [4.74.0] - 2026-08-26

### Added
- **Task-integrity guard** (`CORTEX_TASK_INTEGRITY=true`): tool descriptions (WebSearch, WebFetch,
  Bash) now carry explicit integrity clauses — research documentation, never a task's published
  solution; no mining git history or registries for reference implementations — and the env flag
  appends a compact, prefix-stable system line ("verify by running, not by recall") that survives
  the minimal prompt. Built for internet-enabled evaluations (Terminal-Bench 2.1) where
  solution-retrieval trajectories are tracked and penalized — and because shortcut trajectories
  poison training corpora.
- **Busy-wait poll guard** (`CORTEX_POLL_GUARD=true`): the loop ladder now detects repeated
  identical SUCCEEDING calls (status polling, sleep loops) — a failure-blind spot no existing
  guard covered — and nudges once per streak to do useful work and check results once.

### Changed
- **Doctrine-mined tool-description hardening** (evidence: 96-session mining pass, quote-verified,
  arm-filtered): the Bash description's file-inspection guidance is frame-neutral ("when
  Read/Edit/Write are in your tool set"), keeps a binary/forensics carve-out, hardens
  absolute-paths-after-cd, and makes the busy-wait prohibition explicit with observed patterns.

## [4.73.0] - 2026-08-26

### Added
- **Helper-curated doctrine freshness** (`CORTEX_DOCTRINE_CURATION=true`, default off). The
  shipped orient script now maintains machine-authored CORTEX.md sections between markers; when
  the workspace drifts, it stages a mechanical refresh instead of touching the doc, and a helper
  model curates the merge in a disposable side context — applied atomically with a `.prev`
  rollback, a hard size budget, and decisions-store provenance. Delivery is synchronous at
  prefix-rebuild boundaries (the defer lift, or before turn-0 assembly under full mass), bounded
  by a timeout that fails open to the previous doc. The working model never sees a diff or makes
  a merge decision — its first turn stays a pure imperative.
- **Shared helper frame layer**: helper-model calls (compaction, summaries, guidance) now build
  from one persona/grounding/output-budget composition instead of per-surface hardcoded strings.
- **Cache-compliance test gate**: a prefix byte-stability test asserts that appending turns never
  changes how earlier messages serialize — protecting the provider prompt-cache discount that
  dominates agentic-loop economics.

### Fixed
- **Chunked compaction fidelity**: large sessions compacted in chunks now get the full
  8-category structured summary template (previously a bare "summarize this section").
- **Compaction action-stream blindness**: tool calls and tool results now render into the
  compaction digest as one-line shapes — summaries can finally answer "what did the agent do".

### Changed
- **Mentorship guidance never enters the thinking channel**: all helper guidance is delivered as
  attributed `<system-reminder>` text in a user message on every provider (the last synthetic
  thinking-block branch is removed — foreign thinking caused model incongruence). Provider
  wire-validity reasoning fields are untouched.
- Compaction summaries gain a DURABLE PROJECT NOTES category (candidate memory entries).

## [4.72.0] - 2026-08-25

### Added
- **Composable deferred doctrine.** `CORTEX_PROMPT_MASS=defer` now composes with a model card's
  `promptPreset`: a boot-minimal card keeps its narrow ~400-byte prompt on turn 1 and the full
  static corpus (tool guide, work-quality doctrine, project CORTEX.md/AGENTS.md) is appended once
  at the first tool-result boundary — door economics on entry, full knowledge after first action.
  Project docs are read lazily at delivery, so a CORTEX.md generated during turn 1 rides the
  delivery. Previously, setting `defer` disabled the card's narrow prompt entirely.
- **Shipped `orient` script.** The `.cortex` scaffold now includes a generic mechanical
  orientation script: prints a workspace map (structure, package scripts, make targets, README
  head), indexes the installed skill guides with one-line descriptions, notes SearchTools
  discovery, and renders a mechanical `.cortex/CORTEX.md` (never overwriting). The boot-minimal
  prompt now points at a **resolved, real** orient path — a project's own `.cortex/orient` wins,
  else the shipped copy — instead of conditionally probing a relative path that may not exist.
- **Decision stores captured by default** (nexus-canon): a fresh canon setup now captures
  `.cortex/decisions.jsonl` (tool outcomes + steering events) with zero configuration, alongside
  sessions — single-file store roots are now supported in sync config.

### Changed
- **deepseek-v4-pro card: `frameProfile: 'lifted'`** — codifies the measured frame verdict from
  the full Terminal-Bench 2.0 rerun (80.9% lifted vs 74.2% persist on 89 tasks, lifted also
  cheaper per pass). The flash card stays unset: persist wins for flash only as the
  persist + EndTurn-gate combination, armed via environment in bench/serving profiles.

## [4.71.0] - 2026-08-25

### Added
- **Agentic vision — the image-path bridge** (live-verified end-to-end: the model read a generated
  PNG and answered its exact contents in one turn). New `ReadImage` tool (magic-byte-sniffed
  PNG/JPEG/GIF/WebP, 32 MiB cap, actionable errors), offered only to vision-capable model cards
  and present on turn 1; canonical `image` content block rendered per provider dialect
  (chat/completions user-message parts, Anthropic base64 source blocks); images hop from tool
  results to a synthetic user message (providers reject image parts on tool messages).
- **deepseek-v4-flash-vision-exp** model card — DeepSeek's first multimodal model (flash pricing,
  1M context, tool-calls-with-images probe-verified) — plus a probe-gated `vision` capability
  field on model cards.
- **Downscale-at-ingest** (`CORTEX_IMAGE_DOWNSCALE_BYTES`, default 2 MiB): large originals shrink
  to ~800px (the provider's own resize target — lossless to the model, ~100x less wire).
- **Image TTL eviction** (`CORTEX_IMAGE_TTL_TURNS`, default 3): measured — an image anywhere in a
  vision-exp request currently disables prompt-cache reads for the entire request; stale images
  are stubbed out of outgoing requests (history never rewritten), restoring the ~31x cache
  discount for the rest of the session.

### Changed
- The Read tool description no longer claims image/PDF support it never had; it points image work
  at ReadImage.

## [4.70.0] - 2026-08-25

The "three-guard architecture" release — evidence-driven from a full Terminal-Bench 2.0
benchmark of the published harness (4 arms x 89 tasks, trajectory-distilled failure analysis).

### Added
- **Unified outcome layer + loop escalation ladder.** Every tool result is classified once
  (`ok`/`failed`/`error`) from real exit codes — a bash command that fails no longer records as a
  success — and near-duplicate retry attempts collide on a normalized "approach hash". Repeated
  failing approaches now escalate remind(2) → diversify(4) → graceful break(6) instead of burning
  up to 1000 iterations: the model is steered, then pointed at alternative strategies, then asked
  to summarize honestly — never silently killed. Thresholds env-tunable
  (`LOOP_REMIND_AT`/`LOOP_DIVERSIFY_AT`/`LOOP_BREAK_AT`). Decision-store priors and the
  error-family lens now consume the same truth, so "this exact call failed before" and "this
  FAMILY of errors keeps recurring across different inputs" reminders both fire on real failures.
- **EndTurn `requirements` attestation (Stage 4, opt-in `CORTEX_ENDTURN_REQUIREMENTS=true`).**
  The EndTurn gate can now demand a re-read of the original task statement: one row per stated
  requirement with what satisfies it and the command/observation that proves it (or an explicit
  "UNVERIFIED"). Mutating turns with an empty `verification` list are challenged. Targets the
  wrong-artifact failure class (finished early, verifier rejected). Gate fallback-accepts after
  the bounded nudges are exhausted — and that fallback is now recorded (see observability below).
- **Inaction guard (opt-in `CORTEX_INACTION_NUDGE=true`).** Detects the inverse pathology of
  looping: a long analysis with ZERO tool calls in a tool-capable request. One bounded "act
  first" steering retry, first-turn-only, threshold `CORTEX_INACTION_MIN_CHARS` (default 4000).
- **Steering observability.** Injected steering (budget pressure, diversity warnings, ladder
  escalations), EndTurn gate fallbacks, and inaction nudges are recorded as kind-tagged event
  rows in the decision store — visible to analysis tooling, provably invisible to priors.
- **`CORTEX_BASH_PIPEFAIL=true` (opt-in).** Wraps commands with `set -o pipefail` so
  `failing-cmd | tail` propagates the failure instead of masking it behind the pipe's exit 0.
- **Per-model frame profile.** `frameProfile: 'lifted' | 'persist'` on model cards +
  `CORTEX_TOOL_ANCHOR_PERSIST` env: 'persist' keeps the first-turn tool anchor for the whole
  session (previously experiment-only). Default remains 'lifted' (unchanged behavior); no card
  ships a value yet — tier defaults await post-release measurement.

### Changed
- **Frame-coherent read/write permissions.** Bash reads (`cat`/`head`/`tail`/`nl`/`sed -n`) now
  register with the read-before-edit guard, so reading a file through bash legitimately unlocks
  `Edit` — essential under narrow tool surfaces that have no Read tool. Denial messages are
  frame-aware (they advise `cat -n`/`sed -n` when the Read tool is not on the surface). Bash
  in-place writes (`sed -i`/`perl -i`/`>`/`>>`/`tee`) invalidate read state so later edits demand
  a fresh look. A `Write`-created file is immediately editable (the model authored its content).
- **Canon store multi-writer safety.** Canon pushes rebase-retry on conflict and abort clean on
  real conflicts across all commit paths (guardedPush).

## [4.69.1] - 2026-08-22

### Changed
- Dedicated-tool steering (the "use the Read tool instead of `cat`" class) is resolved from the
  active MODEL CARD's anchor profile, threaded per-orchestrator into the executors — bash-door
  models get redirects-off per session with no env needed. `CORTEX_TOOL_REDIRECTS=on|off` remains
  the absolute override; `CORTEX_TOOL_ANCHOR=none|full|off` cancels the card signal.

## [4.69.0] - 2026-08-22

### Changed
- **Heredoc-aware bash permissions.** Structural command analysis replaces the old
  every-`<`/`>`-is-unsafe rule: stdin-only heredocs of safe commands are whitelisted, `>`/`>>` to
  a file classifies as a WRITE (auto-approvable parity with the Write tool), null sinks stay
  safe, and danger scans no longer read non-interpreter heredoc BODIES (writing a script that
  merely contains `rm -rf` no longer trips DANGEROUS) while `bash <<EOF` bodies keep full scan.
- Redirect steering defaults OFF for bash-framed sessions (measured +26% tool calls / +30%
  latency at zero accuracy gain when left on); `CORTEX_TOOL_REDIRECTS` still wins.
- nexus-canon 1.9.5: mass-deletion guard moved to the shared choke point (covers ALL verbs) +
  atomic clone.

## [4.68.0] - 2026-08-20

### Added
- First-run onboarding block (shown once) across all TUI surfaces.

### Changed
- TUI first paint 1047ms → 37ms (heavy imports made dynamic; a starting banner beats them);
  launch-width picker freeze fixed via debounced resize redraw.
- nexus-canon 1.9.4: canon-sync mass-deletion guard (>10 staged deletions aborts loudly).

## [4.67.0] - 2026-08-20

### Changed
- Keybinding hints are keymap-as-data (`TUI_KEYMAP`): all hint sites render from one per-surface
  truth table, fixing hints that advertised bindings the handlers never implemented.

## [4.66.0] - 2026-08-19 (first published with 4.67.0)

### Changed
- **System-prompt delivery (R63) is DEFAULT ON** (`CORTEX_DELIVER_SYSTEM_PROMPT=false` opts out)
  — chat/completions and Responses providers now receive the system corpus correctly.
- DeepSeek family cards carry `promptPreset: 'boot-minimal'` — the measured winner (equal
  accuracy at −68% input / −37..85% output vs the full corpus), so correct delivery costs LESS
  than the promptless era. nexus-canon 1.9.3: orphaned staging files can no longer be committed.

## [4.65.0] - 2026-08-19 (first published with 4.67.0)

### Added
- `CORTEX_PROMPT_MASS=defer` — minimal turn 1, full static corpus delivered once at the first
  tool-result boundary (for corpora that cannot be pulled from the workspace).
- R63 system-prompt delivery lands opt-in (see 4.66.0 for the default flip).

### Changed
- **Tool budgets are failsafes, not work limits (R64).** `MAX_TOOL_ITERATIONS` 50 → 1000,
  `TOOL_BUDGET_SOFT` 15 → 400 (0 disables budget pressure cleanly) — the old caps severed
  legitimate deep-repo work and induced fabricated completions under wrap-up pressure.

## [4.63.10] - 2026-08-17

### Changed
- deepseek-v4-pro home-door anchor corrected to `bash-edit` (−41% output tokens vs control);
  DeepSeek family unified on the 2-tool door shape.

## [4.63.9] - 2026-08-17

### Added
- Per-family home-door anchors on model cards (210-run evidence): deepseek-v4-flash `bash-edit`,
  pro/grok family `bash-plus`. `CORTEX_TOOL_ANCHOR` env still overrides; 'none' disables.

## [4.63.x] - 2026-08-15 → 2026-08-17 (the canon-store line, patch train)

### Added
- nexus-canon 1.7.0 (`canon pull --native`: byte-exact reverse materialization of
  original-harness sessions), 1.8.0 (per-project memory rides the canon handoff), 1.9.0/1.9.1
  (`--recent N` recency-windowed bulk hydration + size caps).

### Fixed
- nexus-canon 1.8.1/1.8.2 (true timestamps on native pulls; subagent transcripts no longer
  promoted to top-level), 1.9.2 (TUI /help inline), plus torn-line sync probes.
- TUI: SIGWINCH resize handling, stream-error recovery, slash-palette submit fixes
  (4.61.1/4.63.8).

## [4.62.0] - 2026-08-15

### Changed
- **Bash tool modernization (R61):** redirect steering is flag- and profile-aware, PTY completion
  uses a sentinel instead of prompt heuristics, timeout clamped to 600s, tool description no
  longer overclaims working-directory persistence.

### Added
- Anthropic subscription-token compliance gate: `sk-ant-oat01` tokens are blocked off the raw
  Messages path unless explicitly approved; `ANTHROPIC_AUTH_TOKEN` is a first-class bearer
  credential.

## [4.61.0] - 2026-08-14

### Added
- GPT-5.6 Terra + Luna tier cards; bench-CLI tool-profile auto-stamp; gemini thinkingLevel
  plumbing.

## [4.60.0 – 4.60.3] - 2026-08-13 → 2026-08-14

### Added
- Model cards: gemini-3.6-flash, gemini-3.7-flash, gpt-5.6 (Sol) — all smoke-verified live.

### Fixed
- nexus-canon 1.6.4-1.6.6: torn-tail sync probes (harness + browser legs) and a scrub-pattern
  fix that was tearing long floats.

## [4.59.0] - 2026-08-13

### Added
- `CORTEX_TOOL_PROFILE=full|lean|bash-only` — env-selected tool-surface restriction applied at
  the single tool-catalog choke point, with a dispatch-time gate so hidden tools cannot execute;
  active profile auto-stamped into decision records.

## [4.58.0] - 2026-08-13

### Added
- First-class canon tools: `CanonListSessions` + `CanonPullSession` — agent-callable faces of the
  cross-harness portable memory rail, plus a Cross-Session Memory section in the system prompt.

## [4.57.3] - 2026-08-13

### Fixed
- nexus-canon 1.6.3: centralized git exec (auth + commit identity + piped stderr on every canon
  verb) — fixes hosted-container "Author identity unknown".

## [4.57.2] - 2026-08-13

### Fixed
- **Canon-sync git errors no longer print into the hosted terminal.** Git stderr is
  captured (piped) instead of inherited, and clone failures now log a redacted,
  actionable line — a missing/revoked token tells hosted users to re-save the canon
  store credential in CORTEX -> Connections (nexus-canon 1.6.2).

## [4.57.1] - 2026-08-13

### Added
- **True reasoning-cost visibility.** Normalized usage now surfaces `reasoningTokens`
  (read from `completion_tokens_details` / `output_tokens_details` / flat
  `usage.reasoning_tokens`) — on the xAI Responses path this is the only client-visible
  accounting of internal-reasoning spend, since the reasoning body is an encrypted blob.
  `TokenUsageMetrics` now documents that `costUsd` (returned on xAI paths) is the
  authoritative post-discount billed amount and should be preferred over token-math
  estimates when present.

## [4.57.0] - 2026-08-13

### Added
- **xAI Grok 4.6.** New frontier model — 500K context, vision (image → text), reasoning,
  function calling, structured outputs; $2.00 / $0.50 cached / $6.00 output per 1M tokens
  (<200k prompt). Two transport variants are registered: `grok-4.6` (Messages API,
  interleaved thinking via `reasoning_content`) and `grok-4.6-responses` (Responses API,
  encrypted reasoning + xAI server-side tools). Both adapters verified operational.

## [4.56.5] - 2026-08-12

### Fixed
- **Canon-store git token no longer leaks into logs or the terminal.** The hosted harness
  embedded the token in the `CANON_REPO` clone URL and `canon-sync` logged that URL, printing
  it into the interactive terminal. The token now rides in `GH_TOKEN` and git authenticates via
  `http.extraheader` (never in a URL, `.git/config`, argv, or a log line); any credentialed URL
  is redacted before logging (`redactRepoUrl`). A git identity is set so the container commit
  succeeds (fixes "Author identity unknown"), and reactive canon-sync status is routed to
  `CANON_LOG_FILE` instead of corrupting the TUI render. (nexus-canon 1.6.1.)

## [4.56.4] - 2026-08-12

### Changed
- **One canonical `.env` loader for every entry point.** CLI, TUI, and server now bootstrap
  the environment through a single `bootstrapEnv()` in `@nexus-cortex/core` (resolves cwd →
  package root → global `~/.cortex/.env`, first-wins so an injected key is never clobbered),
  replacing per-binary dotenv handling. Fixes the spurious "No .env found" warning some TUIs
  emitted and makes key/config resolution consistent across all surfaces.

## [4.56.3] - 2026-08-11

### Fixed
- **Proxied provider calls no longer blocked by Cloudflare "Block AI bots" / Bot Fight Mode.**
  When routing through `CORTEX_PROXY_BASE_URL`, `cortexProxyFetch` now overrides the provider
  SDK's `User-Agent` (e.g. the OpenAI SDK's `OpenAI/JS`, used for DeepSeek + OpenAI-compatible
  providers) with a benign `nexus-cortex-proxy/1.0`, so a proxy zone with AI-bot filtering no
  longer rejects requests with 403 "Your request was blocked." No Cloudflare config change
  needed, and immune to future managed-bot rule updates.

## [4.56.2] - 2026-08-10

### Fixed
- **Deterministic proxy routing for provider calls.** With `CORTEX_PROXY_BASE_URL` set (hosted
  / user-funded jobs), provider API calls now use a call-time proxy-aware `fetch` passed
  explicitly to every OpenAI and Anthropic SDK client (and every raw provider `fetch`), instead
  of a `globalThis.fetch` monkey-patch the OpenAI SDK bypassed — fixing spurious "invalid api
  key" 401s where a per-job proxy token was sent directly to the provider. Google SDKs keep the
  global patch (they accept no `fetch` option).

### Added
- **Canon graph cognition dimension (§27l).** `canon graph` can fold agent reasoning / j-space
  state into the project knowledge graph (opt-in). (nexus-canon 1.6.0.)

## [4.56.1] - 2026-08-05

### Added
- **Browser CORTEX is the fifth captured harness.** Canon now captures browser CORTEX sessions
  (`/native/browser-cortex/`), integrating per-client `browser-cortex-<id>` branches into main
  automatically (browsers never force main); reactive capture runs the full pipeline
  (sync → translate → graph). (nexus-canon 1.5.0.)

## [4.56.0] - 2026-08-04

### Added
- **Reactive canon capture.** The canon store now updates itself instead of waiting
  for a manual `canon sync`:
  - **Turn hook** — with `CANON_AUTO_SYNC=true`, the orchestrator schedules a
    debounced sync after every completed turn (a burst of turns collapses into one
    commit). Opt-in, best-effort, never affects the turn. Configure with
    `cortex config set CANON_AUTO_SYNC true` (hot-applies, no restart) plus
    `CANON_AUTO_SYNC_DEBOUNCE_MS` / `CANON_STORE` / `CANON_REPO` (category: session).
  - **`cortex canon watch`** — a long-running watcher over every declared harness
    session root (Claude Code, grok, gemini, cortex — the `HARNESSES.json`-driven
    list) that fires the same debounced sync when any session file changes. Covers
    sessions written by *other* processes; an initial catch-up sync runs at startup.
    Also available on the standalone bin: `nexus-canon watch`.
- **Pull tool capsule (Phase E rung 4, shipped in the 1.3.0 artifact, recorded here).**
  `canon pull` writes `<uuid>.tools.md` next to the materialized session: the
  tool-compatibility report plus original calls (count + sample inputs) of every
  unmapped/MCP tool, so the receiving model can re-express intent against its local
  tool menu. New exports: `sessionToolCalls`, `renderCapsule`.

## [4.55.2] - 2026-08-03

### Added
- **Arg-schema morphisms (Phase E rung 2).** `morphToolCall(call, source, target)`
  re-expresses a tool call in the target harness's argument dialect via the
  empirically-seeded `ARG_MORPHISMS` table — renames applied, unsupported fields
  dropped and reported (never silent), each morphism graded observed/spec/unverified.
  The `canon pull` compatibility report now shows per-mapped-tool arg fidelity.
- **Touched tier 3b.** Interpreter-body write parsing (python `open(w/a)`/`write_text`,
  node `writeFileSync` literals, effective-cwd resolution) contributes AMBIGUOUS-grade
  touched evidence — the third evidence channel.

## [4.55.1] - 2026-08-02

### Added
- **Tool-ontology compatibility (Phase E rung 1).** `canon pull` prints a per-harness
  compatibility report (native / name-mapped via the 14-concept cross-harness table /
  MCP / unmapped — comprehension is never capability-bound); `canon tools` derives the
  observed tool inventory per harness from the canonical line.
- **Touched tier 2b.** `file-history-delta` sidecar events contribute EXTRACTED-grade
  write evidence — covering Bash/interpreter-body mutations of tracked files.

## [4.55.0] - 2026-08-02

### Added
- **Two new harness adapters — all four captured harnesses now translate.**
  grok-build sessions (`chat_history.jsonl`: xAI reasoning → thinking blocks, OpenAI
  `tool_calls` → `tool_use`, per-message model provenance; telemetry events → sidecars)
  and gemini-cli sessions (the current `chats/*.jsonl` event-sourced format with
  supersede-by-id updates: thoughts → thinking blocks, embedded tool calls + results →
  paired `tool_use`/`tool_result`, per-message model/usage — mid-session model switches
  captured). Onboarding runbook: **[HARNESS_ONBOARDING.md](docs/HARNESS_ONBOARDING.md)**.
- **File-history snapshots in the harness.** File-mutating tool calls are checkpointed
  content-addressably and recorded as `file-history-snapshot` records in the session
  JSONL (Claude Code parity) — canon's graph consumes them as write evidence.
- **The history↔code semantic join.** `canon graph` scans session content for
  session→file `touched` edges (three evidence tiers incl. Bash command parsing at
  INFERRED confidence), routes cross-project touches to the owning project's graph, and
  auto-folds a graphify `graph.json` found at the project root. Content-hash guarded —
  safe on any cron cadence.
- **Portability.** Project↔session mapping is fully environment-derived with
  `projects/ROOTS.json` overrides; capture sources are declarative via
  `HARNESSES.json` — adding a harness to capture is configuration, not code.

## [4.54.1] - 2026-08-02

### Added
- **`nexus-canon` 1.0.0 — the canon pipeline as a standalone package.** Portable agent
  memory without the harness: `npm i -g nexus-canon` gives you `init` / `sync` /
  `translate` / `list` / `pull` / `artifacts` / `graph` as a tiny, dependency-free
  install (Node built-ins + `@nexus-cortex/types` only — no provider SDKs).
  `@nexus-cortex/core` and the `cortex canon` verbs now re-export the same package,
  so the harness, schedulers, and standalone users run one implementation.

## [4.54.0] - 2026-08-02

### Added
- **`cortex canon` verb suite** — the canon pipeline graduates into the library:
  `init` (scaffold a canon store repository: directory taxonomy, `merge=union`
  `.gitattributes`, verification workflow, README), `sync`, `translate`, `list`
  (+`--project`), `pull`, `artifacts`, and `graph`. The pipeline logic lives in
  `@nexus-cortex/core` — one implementation serves the CLI and any cron wrapper,
  byte-identical with the proven standalone scripts it graduates.
- **`ArtifactManifest`** — canon's second canonical record kind: capability artifacts
  (skills, agents, MCP configs, plugins) and the intent layer (projects, plans) as
  versioned, blob-addressed bundles with provenance and per-harness projection rules.
- **Project-scoped knowledge graphs** — `cortex canon graph` derives
  `/projects/<id>/graph.json` (NetworkX node-link; every edge carries `confidence` +
  `confidence_score`) from both record kinds, with a derived project↔session map and a
  `--merge-graph` seam for folding external code-graph output into the same structure.
- **`jspaceState?`** — optional per-turn agent-state annotation on canonical messages
  (lens id, basis version, inline summary vector, blob-tier trajectory ref).
  Non-breaking by construction. See **[Canon](docs/CANON.md)**.

## [4.53.0] - 2026-08-02

### Added
- **`GitHistoryStore` — a git-backed session history backend.** Canon's session store gains
  a git backend: canonical session JSONL lives inside a git working clone, each write is a
  commit, with optional pull-on-read and push-on-write — *your agent memory is a git repo
  you own*. It decorates the existing `JSONLHistoryStore` (the canonical record format is
  reused verbatim), is dependency-free, and never mutates your global git config. Exported
  from `@nexus-cortex/core`. See **[Canon](docs/CANON.md)**.
- **Portable-agent-memory positioning.** README and npm keywords now name the pattern the
  field calls *portable agent memory* / *cross-harness handoff*, matching what canon has
  done since before the term existed.

## [4.50.2] - 2026-07-24

### Fixed
- Permissions profiles listed snake_case aliases (`memory_write`/`memory_recall`) that no
  registry ever registers — removed; only `MemoryWrite`/`MemoryRecall` are canonical. The
  permission-audit test now recognizes both (and counts `MemoryRecall` in the prod
  read-only minimum). Memory-tools test aligned with the documented 2-64-char slug rule.
  4.50.2 is the release vehicle for 4.50.0's features (4.50.0/4.50.1 tags never published:
  CI's doc-count and test gates caught the above in sequence).

## [4.50.1] - 2026-07-24

### Fixed
- README registry counts regenerated against a fresh build (47 built-in tools after
  `MemoryWrite`/`MemoryRecall`). The v4.50.0 tag never published: CI's doc-count gate
  correctly rejected counts generated from a stale local build. No code changes —
  4.50.1 is the release vehicle for 4.50.0's features.

## [4.50.0] - 2026-07-24

### Added
- **Two-tier persistent memory.** `.cortex/MEMORY.md` is now a curated one-line-per-memory
  INDEX injected every session at high priority (above the project-docs band — an
  always-present index carries more model salience than large static documents); per-fact
  detail lives in `.cortex/memory/<name>.md` files with `name`/`description`/`type`
  frontmatter.
- **`MemoryWrite` tool** — create/update/delete a memory with dedupe-by-name (writing an
  existing name updates it), typed categories (`user`/`feedback`/`project`/`reference`),
  and automatic index-line maintenance.
- **`MemoryRecall` tool** (essential tier — always visible) — load a memory's full detail
  by name, or search names/descriptions/content. Falls back to searching a legacy
  monolithic `MEMORY.md` + `MEMORY.archive.md`, so existing projects need no migration.
- `cortex init` scaffolds the new index + `memory/` directory shape.

### Changed
- **Memory size-governance defaults ON**: `MEMORY_ARCHIVE_MAX_BYTES` now defaults to
  `10000` — when the hot `MEMORY.md` exceeds the budget, the overflow moves LOSSLESSLY to
  `MEMORY.archive.md` (a pointer remains). Set `0` to opt out. On first load after
  upgrade, an over-budget `MEMORY.md` is pruned with all content preserved in the archive.
- `MEMORY.md` is now EXEMPT from the head-truncating `SYSTEM_MESSAGE_DOC_MAX_BYTES` cap
  (which dropped the newest memories).
- Sub-agent processes are READ-ONLY on memory (`MemoryWrite` refuses with guidance) — the
  parent session owns writes; sub-agents recall and report findings in their results.

### Notes
- The memory index's higher injection priority plus the two new tools change the static
  prompt prefix — expect a ONE-TIME provider prompt-cache miss per environment after
  upgrading.

---

## [4.49.0] - 2026-07-12

### Added
- hf-space generic card: `HF_SPACE_TEMPERATURE` (card-level sampling pin) and
  `HF_SPACE_EXPECT_MODEL` (identity assert — the transport hard-fails when the Space's
  `[MODEL=...]` header doesn't match, so a served adapter is never silently the wrong model).
- hf-space per-model cards: per-slug env overrides matching the `HF_SPACE_ID_<SLUG>`
  convention — `HF_SPACE_TEMPERATURE_<SLUG>` (sampling pin) and `HF_SPACE_EXPECT_MODEL_<SLUG>`
  (identity-assert override), so a fine-tuned ADAPTER of a card's base model can be served
  and validated through the same card.

### Fixed
- hf-space per-model cards: `defaultTemperature` from the model spec is now actually wired
  into the card. It was previously dead weight — per-model card calls fell through to the
  request temperature or 0.7, the exact condition the near-greedy sweeps proved wrong for
  format-fragile small tool-callers.

## [4.48.0] - 2026-07-11

### Added
- hf-space transport: 6th tool-call parser family — Gemma-4 channel format
  (`<|tool_call>call:name{...}<tool_call|>` with quote-token arguments, plus `<|channel>thought`
  reasoning extraction), verified against a live gemma-4-E2B-it probe. New end-token handling
  strips `<|end_of_text|>` (Granite) and `<turn|>` (Gemma) terminators from completions.
- hf-space model cards for the 2026-07 onboarding wave: granite-4.1-3b, qwen3.5-2b,
  qwen3.5-2b-khazarai, nemotron-3-nano-4b, gemma-4-e2b, arctic-awm-4b.
- Bench: new `tool-route` verifier — grades the FIRST tool call (name + args, partial credit,
  substring arg match) instead of the final text, so routing-component models are measured on
  routing correctness rather than task completion. `HarnessRunResult` now carries the ordered
  `toolUses` trace, and `gradeRun` accepts it via a new optional `extras` parameter.

## [4.47.4] - 2026-07-10

### Fixed
- Router training record now captures the actual routing tool + its input args. The cortex
  training recorder was writing turn-quality metadata into `selected_args_json` instead of the
  tool call, so a fine-tune on that corpus learned to emit the metadata as "arguments". Now
  records the first real (non-EndTurn) tool of the turn with its actual input; the quality
  metadata still feeds `outcomeScore`.

## [4.47.3] - 2026-07-09

### Fixed
- CI: updated the `/models` endpoint test allowlists for providers added in 4.47.0 (`owned_by`
  accepts `local`/`huggingface`/`hf-space`; `apiPattern` accepts `hf-space`). Test-only. This is
  the first npm release since 4.47.0 — the 4.47.1 server-side-tools fix and 4.47.2 test fix ship
  here (their tags were blocked at the CI gate by these stale tests).

## [4.47.2] - 2026-07-09

### Fixed
- CI: updated a stale adapter-registry test (expected 5 API patterns; the hf-space transport in
  4.47.0 made it 6). Test-only. Note: **4.47.1 never reached npm** — its publish was blocked by
  this test — so 4.47.2 is the first npm release carrying the 4.47.1 server-side-tools fix.

## [4.47.1] - 2026-07-09

### Fixed
- **xAI server-side tools (`x_search`, `web_search`, `code_execution`) were silently unavailable**
  when deferred tool loading was enabled (its default). The orchestrator injected them correctly,
  but the deferred-loading filter kept only essential/recently-used tools and stripped the injected
  server-side tools from every request — and they weren't rediscoverable via SearchTools. Grok then
  never switched to the Responses API and fell back to the harness's own WebSearch. Server-side
  tools are now marked essential (they have empty schemas, so the eager cost is negligible) and
  survive the filter; live X search works again on Responses-capable xAI models.

## [4.47.0] - 2026-07-09

### Added
- **Self-hosted & Hugging Face Space model inference.** A generic local/HF inference path for the
  harness and helper models, plus a native **hf-space provider transport** that drives HuggingFace
  Gradio Spaces directly. Reasoning-mode support for local/self-hosted models, and local/self-hosted
  models no longer require an API key. `HF_TOKEN` is accepted as an alias for `HUGGINGFACE_API_KEY`;
  `BENCH_MODEL_ENDPOINT` points the bake-off at a self-hosted model.
- **Per-model HF Space cards + served-model verification.** Qwen3.5-0.8B bake-off candidate cards and
  per-model HF Space cards, each with a served-model verification guard so a Space serving the wrong
  checkpoint fails loudly. Vendor-recommended sampling defaults are applied per model.
- **Automatic HF Space GPU billing management.** The server starts the configured HF Space's GPU on
  startup and stops it on shutdown, so a dedicated-GPU bake-off Space isn't billed while idle.
- **vLLM template variant** with prefix caching for multi-turn tool loops.
- **Grok 4.5 card** (xAI flagship, released 2026-07-09).
- **Archive-aware `MEMORY.md` pruning** (`MEMORY_ARCHIVE_MAX_BYTES`; code default off, shipped on at
  `10000` in `.env` / `.env.example`). When `MEMORY.md` exceeds the cap, older overflow **moves** to a
  sibling append-only `MEMORY.archive.md` and `MEMORY.md` is bounded — fixing unbounded memory growth
  and full-file injection without dropping the newest entries the way the injection head-truncation
  did. Applied only to CORTEX-owned memory locations; the model Reads the archive on demand.
- **Work-swarm claim/release on the deficiency pool.** `cortex autoresearch backlog list/show/next/
  resolve` gives deficiency-pool visibility, and a new `ResearchBacklog` executor tool
  (`claim`/`claim_next`/`release`) lets multiple agents coordinate over one pool with a TTL lease, so
  a crashed claimant's item is auto-released — the divide-and-conquer counterpart to the competitive
  `loop`.
- **Turn-prediction graduation signal (capture Phase 2).** A deterministic next-turn-prediction
  scorer + STDB-backed store feeding the training pipeline, with tri-state prefill provenance
  (`none`/`shown`/`inserted`) on each record so self-fulfilled predictions are excluded from the
  graduation exam.

### Fixed
- hf-space transport: emulate streaming for the blocking Gradio transport; parse Phi token-wrapped
  tool calls; detect templates that ignore the `tools` kwarg (by render comparison) and fall back to
  prompt-injected tools; treat an unterminated `<think>` block as reasoning not content; coerce null
  message content to an empty string.
- autoresearch: raise the bench fetch timeout past undici's 300s default (long graded runs).
- gateway: don't require an API key for local/self-hosted models. skills: pdf-documents HF image
  endpoint → `router.huggingface.co`. Removed stale/untested HF inference paths.

### Docs
- Env + `docs/AUTORESEARCH.md`: `BENCH_MODEL_ENDPOINT` for self-hosted bake-off models; vLLM pilot
  findings (SM80+ requirement, prompt-echo debugging, `DTYPE` knob).

## [4.46.0] - 2026-07-08

Internal version-sync release (dependency alignment across the workspace, no user-facing changes).
The work-swarm backlog tooling and turn-prediction capture that landed after this bump ship in
**4.47.0** above.

## [4.45.0] - 2026-07-04

### Added
- **Multi-provider swarm fan-out for the autoresearch loop.** `cortex autoresearch loop --width N`
  fans each round into N parallel candidate arms — each arm gets its own git worktree and its own
  Fixer model, competing on the same goal. Every arm's experiment runs with `--n-family <width>`,
  so the statistical gate's FWER correction tightens with the true family width; the best
  gate-accepted arm merges (with `--require-judge`, the judge reviews accepted arms in effect
  order until one is approved). Losing arms are dropped; per-arm results land in the round
  history (`arms[]`, `winnerArm`).
- **Arm-pool selection.** `--arm-models a,b,c` rotates explicit model ids across arms (arm 1
  keeps `--model`); `--providers deepseek,anthropic,…` draws each provider's flagship
  tool-supporting model; with neither given, the pool auto-derives from providers with a
  configured API key (honoring `MODEL_ROUTER_EXCLUDE`, default `grok*`).
- **`--missing-provider-key-policy platform_fallback|omit|redistribute`** — what happens to an
  arm whose model's provider key isn't configured: run anyway (an upstream proxy may fund it),
  drop the arm, or reassign it to a funded model.
- Per-arm environment for `--fixer-cmd` arms (`CORTEX_ARM_INDEX`/`CORTEX_ARM_MODEL`/
  `CORTEX_ARM_STRATEGY`); per-arm `fixer:<model>` strategy labels recorded into the router
  matrix so the effectiveness layer ranks fixer models over time.
- `AUTORESEARCH_DEBUG=1` includes the error stack in `experiment --json` error output.
- Core registry barrel exports `hasApiKeyForModel` / `modelWithKeyFallback`.

### Fixed
- The loop's `--model` now actually reaches the LLM Fixer (it was documented as the Fixer
  model but was only ever passed to the experiment grader).
- Task-set verifiers are validated at load time (type-specific payload checks) — a malformed
  verifier previously surfaced as an opaque grading crash inside every arm.
- An experiment returning parseable JSON without a verdict (bad task-set, missing provider key)
  is recorded as a reasoned `no-verdict` skip with the captured cause, not a silent reject.

### Docs
- `docs/AUTORESEARCH.md` documents the fan-out lifecycle + flags; the in-package autoresearch/
  cortex-bench skills and the `autoresearch-agent` profile describe width-arm campaigns (the
  container Fixer knows it may be one of N competing arms).

## [4.44.2] - 2026-07-02

### Added
- `cortex autoresearch fix --json` verdict now includes `usage: { inputTokens, outputTokens, model }` — the Fixer records no router-matrix entries, so this is the usage source for downstream spend metering/telemetry of fix runs.

## [4.44.1] - 2026-07-01

### Fixed

- **Claude Sonnet 5 extended thinking** — Sonnet 5 (like Opus 4.7/4.8 and Fable 5) requires the
  adaptive-thinking request surface and rejects the legacy shape with a 400
  (`"thinking.type.enabled" is not supported… use adaptive + output_config.effort`). Its family
  (`claude-5`) was missing from the adaptive-thinking set, so it fell through to
  `thinking:{type:'enabled', budget_tokens}` + `temperature`. Added `claude-5` so Sonnet 5 sends
  `thinking:{type:'adaptive'}` + `output_config.effort` and omits `temperature`. Validated live.

## [4.44.0] - 2026-06-30

### Added

- **Claude Sonnet 5** (`claude-sonnet-5`) — 1M context, adaptive thinking, $3/$15 per MTok
  (introductory $2/$10 through 2026-08-31).

### Changed

- **Cloudflare cached-token pricing is now per-model.** The cache cost-savings estimate derives
  the cached-input discount from each model's actual published cached price
  (e.g. GLM 5.2 = 1 − $0.26/$1.40 ≈ 81%) instead of a flat 75%. Added an optional `cachedInputCost`
  to the Cloudflare model configurator; set for GLM 5.2 ($0.26) and Kimi K2.7 Code ($0.19). Cache
  hit-rate/token counts were already accurate — this only sharpens the dollar estimate.

## [4.43.0] - 2026-06-30

### Added

- **4 new Cloudflare Workers AI models** (verified against the live catalog): GLM 5.2
  (`@cf/zai-org/glm-5.2`), Kimi K2.7 Code (`@cf/moonshotai/kimi-k2.7-code`), Qwen2.5 Coder 32B
  (`@cf/qwen/qwen2.5-coder-32b-instruct`), DeepSeek R1 Distill Qwen 32B
  (`@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`).

## [4.42.0] - 2026-06-30

### Added

- **Auto-research failed-arm notification** — when an experiment arm fails (build/verifier error,
  missing provider key, non-zero exit), `loop` now surfaces *why* in the result (`failures` count
  + `failedArms[{round, reason, exitCode}]`) instead of silently dropping the arm, so the driving
  model can react to the skip reason.

## [4.41.0] - 2026-06-30

### Added

- **BYO-key inference proxy mode (`CORTEX_PROXY_BASE_URL`).** When set, outbound AI-provider calls
  are rewritten through a job-token proxy. **Security hardening:** the executor/sandbox never
  receives a raw provider API key — it holds only a short-lived per-job token, and the real key
  stays behind the proxy. Enables user-funded inference without exposing credentials to the run.

## [4.40.0] - 2026-06-28

### Changed

- **Auto-research LLM-judge gate ON by default for campaigns.** A candidate now merges only if the
  statistical gate **and** the LLM judge approve — the judge reads the candidate *diff* and vetoes
  eval-gaming or unsafe code the score-based gate can't see (`mergeEligible = gate-keep ∧
  judge-approve`). Tuned the default judge rubric. Opt out with `--require-judge false`.

## [4.39.0] - 2026-06-28

### Added

- **`cortex autoresearch judge`** subcommand + opt-in LLM-as-judge gate on `loop`/`experiment`
  (`--require-judge`) — a qualitative gate that reviews candidate diffs for correctness and safety
  before a keep decision.

## [4.38.0] - 2026-06-18

### Auto-research: operate on any repo, structured progress

- `--repo` / `--base-dir` / `--candidate-dir` accept a PUBLIC http(s) git URL and clone it on demand (credential-free, shallow, idempotent); local paths unchanged.
- `--task-set` / `--holdout-set` relative paths resolve against the repo checkout, so a caller can reference a task-set that lives inside the repo.
- `loop --json` streams JSONL progress events (`round_start` / `fix` / `experiment` / `gate` / `round_done` / `stop`) before the final summary object, so a host can track a long run without scraping human output.
- New `docs/AUTORESEARCH.md` — OSS guide to the auto-research system (CLI commands, task-set format, the Monte-Carlo gate, target modes, models, git safety, the hosted MCP).

## [4.37.6] - 2026-06-16

### Added

- **`cortex init`** — generate a project `CORTEX.md` context file from the headless CLI, matching
  the TUI's `/init`. It runs the `init_cortex_context` tool to scan the project (structure, key
  files, dependencies, npm scripts) and write `.cortex/CORTEX.md`, which is auto-loaded as project
  context on subsequent runs.

---

## [4.37.5] - 2026-06-16

### Added

- **Key-aware sub-agent model fallback.** Complements 4.37.4: if a sub-agent resolves to a model
  whose provider API key isn't configured on this install — a profile pinned to `sonnet`, an explicit
  Task `model` override, or a model-router pick — it now falls back to the orchestrator's model
  instead of failing with "API key not found". When the provider key *is* present, the chosen model
  is honored (so curated per-task models still work on multi-provider installs). Deliberately
  conservative: only an explicit, known, missing key triggers the fallback; unknown models pass
  through. New `modelWithKeyFallback`/`hasApiKeyForModel` in core, applied in `SubAgentManager`'s
  resolver (profile, override, and `auto`/router paths).

---

## [4.37.4] - 2026-06-16

### Fixed

- **Shipped agent profiles no longer hardcode a model — they inherit the orchestrator's model.**
  Nine of the bundled agents pinned a specific model/provider (`code-reviewer`/`doc-writer`/`refactor`
  → `sonnet`, `plan` → `opus`, `explore`/`test-writer` → `haiku`, `a-frontend-landing-page-designer`
  → `gpt-5-mini`, `context-research` → `gemini-2.5-flash-sdk`, `autoresearch-agent` →
  `deepseek-v4-flash`). Since the sub-agent resolver honors a profile's `model` verbatim, invoking
  e.g. `code-reviewer` on a DeepSeek-only install failed (no Anthropic key). All shipped profiles now
  use `model: inherit`, so an agent runs on whatever model the orchestrator is using unless explicitly
  overridden (Task `model` param, or the model router). Curated per-task model selection should come
  from the model router (key-aware), not a hardcoded profile.

---

## [4.37.3] - 2026-06-16

### Fixed

- **Headless `cortex "<task>"` no longer blocks on tool-approval prompts (no second `cortex-server`
  shell needed).** A plain prompt auto-starts a detached server with no TTY, where the interactive
  approval handler can't prompt — so it would fail-fast *deny* every tool needing approval (or, if you
  ran a foreground `cortex-server`, prompt there, forcing you to babysit a second shell). A headless
  server (no TTY) now auto-approves tool execution — the same stance as `cortex agent`, and the only
  workable one when there's no interactive approver. A foreground `cortex-server` in a real terminal
  still prompts interactively. Opt out with `CORTEX_HEADLESS_APPROVE=false` (headless tools that need
  approval then deny). Verified: `cortex "create a file…"` runs the Write tool one-shot, no prompt.

---

## [4.37.2] - 2026-06-16

### Added

- **Your `~/.cortex/` now has obvious, reachable places to add your own skills/agents/commands, and a
  browsable copy of the builtins that stays in sync with the package.** The agents/skills/commands/
  system-messages that ship with nexus-cortex live in the install dir and load automatically (so they
  can never go stale) — but they were buried in `node_modules`, with no clear place for *your* additions.
  On each run, cortex now: (1) seeds `~/.cortex/{agents,skills,commands,system-messages}/` (each with a
  short README) — drop your own there and they load alongside (and override) the builtins; (2) refreshes
  a read-only reference of every builtin at `~/.cortex/builtin/`, version-gated so a package update
  (changed prompt, new skill, etc.) re-syncs the reference. The reference is intentionally *not* a loaded
  tier, so it never creates duplicates. Best-effort and never blocks the CLI.

### Fixed

- **`MEMORY.md` now ships** with the package. The prepack scaffold-vendor only looked for
  `MEMORY.seed.md`, but the deploy renames it to `MEMORY.md` in the published repo, so it was being
  skipped. It now accepts either.

---

## [4.37.1] - 2026-06-16

### Fixed

- **The "no API key" path now also stops a running server, so adding a key just works on the next
  run.** When no key is resolvable, `cortex` prints the guidance and exits — but if a server was
  already running, it was started without a key and had cached that empty config, so even after you
  added a key the next call kept failing until a manual `--shutdown`. Now the no-key path gracefully
  drains any running server before exiting, so the next invocation (after you add the key to
  `~/.cortex/.env` or the environment) starts a fresh server that picks it up. No `--shutdown` dance.

---

## [4.37.0] - 2026-06-16

### Added

- **First-run config bootstrap — `.env.example` becomes `~/.cortex/.env`, with no install
  ceremony.** Previously you had to invoke `cortex` once just to create `~/.cortex/`, drop in a
  `.env`, `--shutdown`, and invoke again — because the first run started a *keyless* server that
  had already cached its (empty) config. Now, before starting any server, `cortex` checks whether
  a provider key is resolvable from the environment **or** a `.env` (cwd or `~/.cortex/`). 
  - If a key is found → it just runs (true one-shot). A secrets-store deployment (Cloudflare/Replit)
    with blank `.env` values works directly: blank values defer to the environment, so the injected
    secret wins — and **nothing is written** to disk.
  - If no key is found → it copies the shipped, all-blank `.env.example` to `~/.cortex/.env` (the
    findable, editable location), prints exactly what to add, and **exits without starting a keyless
    server** (so there's no `--shutdown`/re-invoke dance). Fill the file (or inject the key via your
    environment) and run again.
  
  No `postinstall` script is involved: the package ships `.env.example` and the first run renames it
  to `.env`. All keys in the template are blank, so a value set in the environment always takes
  precedence.

---

## [4.36.2] - 2026-06-16

### Fixed

- **`browse` (and other output-heavy tools) no longer fail with a bare `fetch failed` against the
  auto-started background server.** The `cortex` CLI auto-starts a detached server and piped its
  stdout/stderr to the short-lived client. When the one-shot client exited after its command, the
  read ends of those pipes closed — so the *next* command made the still-running server write to a
  broken pipe (EPIPE), disrupting it and surfacing as `fetch failed` in the client. `browse`
  produces the most server output (via its sub-agent), so it triggered this almost every time,
  while a quiet command like `2+2` often slipped through — which made it look intermittent. The
  detached server now logs to a file (`~/.cortex/server.log`) instead of pipes, so there is no
  reader to disappear and no EPIPE. This also gives a persistent server log to inspect. Readiness
  is detected via `/health` polling, so nothing depended on parsing the server's stdout.
  Verified end-to-end: `2+2` then `browse` against the same detached server now both succeed.

---

## [4.36.1] - 2026-06-16

### Added

- **Zero-config MCP auto-connect via `CORTEX_MCP_AUTOCONNECT` — `browse` now works one-shot on a
  clean install.** Previously the browser MCP only connected if `nexus-browser` was already listed
  in an `MCP_CONFIG.md`; on a fresh install (no config file) the `browse` subagent connected
  nothing and failed. Now the orchestrator also honors `CORTEX_MCP_AUTOCONNECT` (comma-separated
  server names): it connects those servers straight from the built-in registry with **no
  `MCP_CONFIG.md` required**, merged with any config that does exist (the config file still wins on
  name conflicts). The built-in `browse` tool sets `CORTEX_MCP_AUTOCONNECT=nexus-browser` on its
  subagent, so a brand-new install runs `browse` with no init/enable/restart ceremony — it
  auto-provisions a free-tier key on first connect (persisted + reused per 4.35.0). Unresolved
  `${ENV}` auth headers (e.g. `Bearer ${NEXUS_BROWSER_API_KEY}` with no key set) are dropped so the
  client auto-provisions instead of sending a broken credential. The flag is opt-in per process, so
  the parent's lean tool surface is unchanged. Verified against the live service: no `MCP_CONFIG.md`
  anywhere → nexus-browser connected with 38 tools.

---

## [4.35.1] - 2026-06-16

### Fixed

- **MCP-management tools (`InitMcpConfig`, `EnableMcpServer`, …) and `InitCortexContext` are
  now discoverable when deferred tool loading is on.** They are gathered separately from the
  main tool factory, but the `SearchTools` index and the deferred-tools harness-note were both
  built only from `toolFactory.getAllTools()` — so these tools were sent to the model in the
  live tool set yet were invisible to discovery. A model asked to "use the MCP init tool" would
  search for it, find nothing, and hand-write the wrong config file (`~/.cortex/mcp.json`
  instead of the canonical `MCP_CONFIG.md`). The SearchTools catalog and the harness-note now
  include the MCP-management and context tools (new "MCP Servers" / "Project Context" groups),
  so the model can find and call `InitMcpConfig`/`EnableMcpServer` and set up an MCP server
  correctly. (Enabling a server still connects it on the next session/restart, as before.)

---

## [4.35.0] - 2026-06-16

### Added

- **HTTP MCP clients now reuse an auto-provisioned API key instead of re-provisioning a new
  one on every connection.** Servers that hand back a key via the `X-Mcp-Token` response header
  (e.g. `nexus-browser`'s free-tier auto-provisioning) previously had that token discarded — so
  the parent process, every sub-agent child process, every server auto-start, and every reconnect
  minted a brand-new key. That fragmented quota across different server-side sessions and
  intermittently tripped the server's per-IP "too many fresh registrations" throttle, surfacing
  as a bare `fetch failed`.

  The client now captures `X-Mcp-Token` and persists it globally (`~/.cortex/.mcp-tokens.json`,
  keyed by server URL), then sends it as `Authorization: Bearer <token>` on subsequent
  connections — so all processes share the **same key → same session/quota**. A static
  subscriber key from the server's configured headers still takes precedence. The client never
  re-provisions on its own: when a free key's quota is depleted, the server's signup message is
  surfaced (via the connection error) rather than silently replaced with another free key,
  preserving the path to a long-running subscriber key.

---

## [4.34.8] - 2026-06-16

### Changed

- **`InitCortexContext` is now surfaced to the model only when the project actually needs
  it.** Rather than always sending it (4.34.7), the tool is deferred by default and promoted
  to `essential` only when the current project has no `.cortex/CORTEX.md` yet. So an
  uninitialized project can discover and run it (you don't have to disable deferred loading),
  while already-initialized projects keep a lean, fully-deferred tool context.

---

## [4.34.7] - 2026-06-16

### Fixed

- **`InitCortexContext` (the `CORTEX.md` / `/init` generator) is now always visible to the
  model.** Its tool definition had no `discoveryTier`, so with deferred tool loading enabled
  (the default) it was deferred — and models reported it "isn't in the tool registry" rather
  than searching for it. Marked it `essential` so it's always sent. Asking the agent to
  generate `CORTEX.md` now works without disabling deferred loading.

---

## [4.34.6] - 2026-06-16

### Fixed

- **The auto-started server now uses the directory you ran `cortex` from as the project
  root.** The bin started the server without telling it the invocation directory, so the
  server fell back to `PROJECT_PATH` from the global `~/.cortex/.env` (often your home dir).
  Result: `cd myproject && cortex "..."` would write `.cortex/` (CORTEX.md, sessions) and
  scope file operations to your home dir instead of `myproject` — e.g. `/init` generated
  `CORTEX.md` in the wrong place. The bin now sets the spawned server's `cwd` +
  `PROJECT_PATH`/`PROJECT_ROOT` to the invocation directory (an explicitly-exported
  `PROJECT_PATH`/`PROJECT_ROOT` still wins, e.g. for the autoresearch container).

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
