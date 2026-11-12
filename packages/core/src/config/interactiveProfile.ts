/**
 * R219 HB-INTERACTIVE-PROFILE (CORTEX_INTERACTIVE_PROFILE, DARK, 2026-10-02).
 *
 * The headless bench stack that produced the TB4.0 gains is configured only through env in the bench cells
 * (.bench/vm/common-cell*.env). An interactive TUI session (neoncortex / fuzzycortex / `cortex` on a terminal)
 * gets only the shipped `.env.defaults`, so every DARK lever stays off there. This module is the ONE place a
 * named profile turns a curated set of those levers on for interactive sessions.
 *
 *   CORTEX_INTERACTIVE_PROFILE = off (default; unset = byte-identical) | bench-lite
 *
 * Rules (all enforced here, nowhere else):
 *   - applies ONLY when the session is interactive (stdin AND stdout are TTYs — the same test the orchestrator
 *     uses for its approval mode, CortexOrchestrator constructor);
 *   - applies ONLY to levers the user has not set explicitly. "Explicit" = present and non-blank in process.env
 *     at the point bootstrapEnv applies the profile: the real environment, ./.env, <packageRoot>/.env and
 *     ~/.cortex/.env. The profile sits ABOVE the shipped `.env.defaults` and BELOW every user layer; `.env.local`
 *     files (explicit developer overrides) still override it afterwards;
 *   - off/unset/unknown name → nothing is written (byte-identical behaviour);
 *   - the keys it filled are recorded in CORTEX_INTERACTIVE_PROFILE_APPLIED (comma list) so the effective-config
 *     dump can label their source `profile`.
 *
 * The TUIs carry no lever logic: they inherit the profile through bootstrapEnv like every other entry point.
 *
 * Classification (full map in the R219 report / master .env ledger): bench-lite = the SAFE-INTERACTIVE set —
 * levers that only change behaviour on a failure path (loop, empty turn, reasoning wall) or only enlarge the
 * inputs of steering calls that already run interactively, with no deadline assumption, no task-tree writes and
 * no new blocking pause before the first action. NEEDS-ADAPTATION and BENCH-ONLY levers are listed in
 * BENCH_LITE_DEFERRED (documentation + test surface only; never applied).
 */

/**
 * 2026-10-17 (operator): the profile ships ON. `CORTEX_PROFILE` (new, preferred; `CORTEX_INTERACTIVE_PROFILE` stays as a legacy alias):
 *   off        — byte-identical to the shipped `.env.defaults` (the pre-10-17 behaviour).
 *   bench-lite — LEGACY: the R219 SAFE-INTERACTIVE set, interactive (TTY) sessions only. Kept for configs that name it.
 *   standard   — SHIPPED DEFAULT: applies to interactive AND headless sessions. bench-lite's seven failure-path/steering-input
 *                levers + the proven session-agnostic levers (outer tool-timeout floor, wall retry ladder + force-action, the
 *                task-conditioned lift-plan scope, the measured mentor reasoning allowance). Every lever is filled only when the
 *                user did not set it, so an explicit value anywhere above the shipped file still wins.
 *   bench-tb4  — OPT-IN REPRODUCTION: the exact library-side lever bundle of the Terminal-Bench 4.0 cells (the c23 "w stack" +
 *                the 10-14 resolver-cell arm): everything in `standard` plus the bench-only / grader-oriented levers (task rules,
 *                verify-at-scale, inventory, orient baseline, workspace clean, PID1 guard, plateau stop, turn status, veto cap,
 *                output cap, effort high, mentor on V4 Pro with thinking on, resolver on flash thinking off, the library
 *                second-attempt chain, web tools / git context / slash hint off). For users reproducing published numbers with
 *                the Harbor executor (docs/REPRODUCING_BENCH_RESULTS.md); not meant for a human-driven session.
 */
export type InteractiveProfileName = 'off' | 'bench-lite' | 'standard' | 'bench-tb4' | 'tools-only' | 'user-fast' | 'user-hybrid' | 'user-careful';
export const PROFILE_ENV = 'CORTEX_PROFILE';
export const LEGACY_PROFILE_ENV = 'CORTEX_INTERACTIVE_PROFILE';

export interface ProfileLever {
  key: string;
  value: string;
  /** Why this lever is safe in a human-driven session. */
  why: string;
}

export interface DeferredLever {
  key: string;
  /** The value the bench cell uses. */
  benchValue: string;
  verdict: 'NEEDS-ADAPTATION' | 'BENCH-ONLY';
  reason: string;
}

/** `tools-only` (2026-11-06, operator: "a tools only profile lever for users that bypasses all the weight of the harness"). The model drives
 *  its tools itself — the browser tools are connected into the MAIN session at boot (no Browse delegate) — and every judge / planner /
 *  mentor / reviewer layer is off. Kept: the two failure-path guards that only fire when something already went wrong (empty-turn
 *  continue stops the no-tools nudge that made a sub-agent invent results; the loop block stops a stuck tool loop). Evidence for the
 *  speed gap: holdout-8 (.bench/eval/om2w) — the same models drove the browser tools directly at ~1 min/task vs 6.5–9.8 min through
 *  `standard`; `standard` also lifted deepseek-flash 4/8 → 8/8, so this profile is OPT-IN and never the shipped default. */
export const TOOLS_ONLY_LEVERS: ReadonlyArray<ProfileLever> = [
  { key: 'CORTEX_MCP_AUTOCONNECT', value: 'nexus-browser', why: 'browser tools in the main session from turn 1 (local library or hosted MCP, per NEXUS_BROWSER_MODE)' },
  { key: 'MCP_AUTO_INJECT', value: 'true', why: 'autoconnected MCP tools are injected into the request (pinned essential)' },
  { key: 'CORTEX_BROWSE_TOOL', value: 'off', why: 'no Browse delegate: the main model drives the browser itself' },
  { key: 'ENABLE_WEBTOOLS', value: 'true', why: 'web tools on regardless of key detection (auto could hide the browser tools on a keyless install)' },
  { key: 'CORTEX_ENDTURN_RESOLVER', value: 'false', why: 'no second-model finish review' },
  { key: 'CORTEX_ENDTURN_GATE', value: 'false', why: 'no citation gate on the finish' },
  { key: 'CORTEX_ENDTURN_REQUIREMENTS', value: 'false', why: 'no requirements gate on the finish' },
  { key: 'CORTEX_ENDTURN_INTEGRITY', value: 'false', why: 'no integrity/sources gate on the finish' },
  { key: 'CORTEX_SCOPE_CHECK', value: 'off', why: 'no scope hold on the finish' },
  { key: 'CORTEX_SECOND_ATTEMPT', value: '0', why: 'no library second attempt' },
  { key: 'CORTEX_LIFT_PLAN', value: 'false', why: 'no planner call after the first tool result' },
  { key: 'CORTEX_LIFT_NUDGE', value: 'false', why: 'no lift pointer reminder' },
  { key: 'MENTORSHIP_ENABLED', value: 'false', why: 'no mentor helper model' },
  { key: 'CORTEX_DEADLINE_EXIT_MENTOR', value: 'false', why: 'no deadline mentor call' },
  { key: 'CORTEX_RECORD_DECISIONS', value: 'false', why: 'no decision capture' },
  { key: 'CORTEX_LOOKUP_PRIOR_DECISIONS', value: 'false', why: 'no prior-decision reminder in the prompt' },
  { key: 'ENABLE_DEFERRED_TOOL_LOADING', value: 'false', why: 'every tool present from turn 1 (no SearchTools discovery round-trips)' },
  { key: 'CORTEX_TOOL_ANCHOR', value: 'none', why: 'no turn-1 tool anchor' },
  { key: 'CORTEX_PROMPT_MASS', value: 'minimal', why: 'minimal system prompt (no tool guides / doctrine mass)' },
  { key: 'CORTEX_EMPTY_TURN_CONTINUE', value: 'true', why: 'KEPT failure-path guard: an empty turn with budget left continues with tools (never the invent-an-answer nudge)' },
  { key: 'CORTEX_LOOP_TOOL_BLOCK', value: 'true', why: 'KEPT failure-path guard: a detected tool loop is blocked + redirected' },
];

/** The SAFE-INTERACTIVE set (bench values from .bench/vm/common-cellv43a.env). */
export const BENCH_LITE_LEVERS: ReadonlyArray<ProfileLever> = [
  { key: 'CORTEX_LOOP_TOOL_BLOCK', value: 'true', why: 'fires only on a detected tool loop; one-turn executor block + redirect (escalation = one bounded exit-planner call)' },
  { key: 'CORTEX_EMPTY_TURN_CONTINUE', value: 'true', why: 'reasoning-only empty turn with budget left continues with tools instead of a forced no-tools answer; with no deadline the budget is iterations only' },
  { key: 'CORTEX_WALL_DROP', value: 'on', why: 'reasoning-exhaustion wall: drop the walled turn from in-memory history (cache-preserving retry); failure path only' },
  { key: 'CORTEX_WALL_SUMMARY', value: 'on', why: 'reasoning-exhaustion wall: one helper call (30 s timeout, fail-open) summarises the walled reasoning into the nudge; failure path only' },
  { key: 'CORTEX_REASONING_EXHAUST_BACKOFF', value: 'false', why: 'paired with WALL_DROP/WALL_SUMMARY: keeps the effort (DeepSeek cache key) instead of stepping it down after a wall' },
  { key: 'CORTEX_STEER_INPUTS', value: 'full', why: 'larger input caps + explicit truncation markers for steering calls (EndTurn judge, exit planner) that already run interactively' },
  { key: 'CORTEX_ORIENT_V2', value: '1', why: 'orient script prints verification entry points / test config / test dirs; read-only, bounded, only when the model runs orient' },
];

/** Bench-cell levers bench-lite deliberately leaves alone (follow-ups / bench-only). Never applied. */
export const BENCH_LITE_DEFERRED: ReadonlyArray<DeferredLever> = [
  { key: 'CORTEX_LIFT_PLAN_INTERACTIVE', benchValue: '(n/a — headless always plans)', verdict: 'NEEDS-ADAPTATION', reason: 'lift plan = one silent 30-110 s mentor call after the first tool result (MiMo K=3 median 108 s at pro max); no planning-status event reaches the TUIs; one-shot per orchestrator so only the FIRST request of a chat is planned; persona is grader-oriented (confirm grader criteria, RETIRE)' },
  { key: 'CORTEX_LIFT_PLAN_SCOPE', benchValue: 'true', verdict: 'NEEDS-ADAPTATION', reason: 'strict repair-task edit scope (never tests/runners/fixtures) fights a human asking for tests; `adaptive` is the candidate but unmeasured; inert while the lift plan is off' },
  { key: 'CORTEX_INVENTORY', benchValue: '1', verdict: 'NEEDS-ADAPTATION', reason: 'whole-tree walk + /proc/1/environ + bench data dirs; the steering env report runs it through execSync (up to 30 s) which blocks the event loop → frozen TUI on a large repo' },
  { key: 'CORTEX_TURN_STATUS', benchValue: 'auto', verdict: 'NEEDS-ADAPTATION', reason: 'auto is a no-op without a turn deadline (interactive has none); `on` prints an elapsed/remaining clock built for a bench budget — needs a deadline-free variant (context + background shells only)' },
  { key: 'CORTEX_VERIFY_SCALE', benchValue: 'on', verdict: 'NEEDS-ADAPTATION', reason: 'adds a GAP rubric item to the EndTurn judge → more vetoes of a finish a human may want; unmeasured; needs a human-override path first' },
  { key: 'CORTEX_RULE_INPUTS', benchValue: 'on', verdict: 'NEEDS-ADAPTATION', reason: 'judge INPUTS rule → GAP + CHECK vetoes (grader rigor); same veto-friction caveat; no bench arm yet' },
  { key: 'CORTEX_RULE_INTERP', benchValue: 'on', verdict: 'NEEDS-ADAPTATION', reason: 'judge INTERPRETATION rule → GAP + CHECK vetoes; a human can resolve ambiguity directly; no bench arm yet' },
  { key: 'CORTEX_RULE_HOLDOUT', benchValue: 'on', verdict: 'NEEDS-ADAPTATION', reason: 'judge HELD-OUT rule assumes hidden-input grading; GAP vetoes; no bench arm yet' },
  { key: 'CORTEX_RULE_INDEP', benchValue: 'on', verdict: 'NEEDS-ADAPTATION', reason: 'judge INDEPENDENT-CHECK rule → GAP vetoes; no bench arm yet' },
  { key: 'CORTEX_ACTION_EFFORT', benchValue: 'high', verdict: 'NEEDS-ADAPTATION', reason: 'a latency/cost preference the TUIs already expose through their reasoning-effort selector; a hidden env floor would fight it' },
  { key: 'CORTEX_WORKSPACE_CLEAN', benchValue: '1', verdict: 'BENCH-ONLY', reason: 'moves project knowledge (CORTEX.md, memory, doctrine) out of the project into the state dir — a grader-clean-tree concern; humans want project memory in the project' },
  { key: 'CORTEX_ORIENT_BASELINE', benchValue: '1', verdict: 'BENCH-ONLY', reason: 'checksum baseline + pre-finish revert line for graded repair tasks; writes <workspace>/.cortex' },
  { key: 'CORTEX_PID1_GUARD', benchValue: 'on', verdict: 'BENCH-ONLY', reason: 'container assumption: on a workstation PID 1 is init/systemd and the "killing it ends your session" note would be wrong' },
  { key: 'CORTEX_PLATEAU_STOP', benchValue: 'status', verdict: 'BENCH-ONLY', reason: 'boot instruction to print PLATEAU_METRIC lines — optimisation-task measurement scaffolding' },
];

/** The proven session-agnostic additions that make `standard` out of bench-lite (ledger lines in the master .env). */
export const STANDARD_EXTRA_LEVERS: ReadonlyArray<ProfileLever> = [
  { key: 'CORTEX_OUTER_TOOL_TIMEOUT_MS', value: '600000', why: 'floor for the outer per-batch tool abort; field-validated 2026-09-14 (0 outer-abort kills vs 5 without); only delays an abort that would have killed a long tool' },
  { key: 'CORTEX_WALL_RETRY_LADDER', value: '65536,16384', why: 'reasoning-exhaustion wall: retry with a smaller max_tokens rung; failure path only (wire-proven 4.124.60)' },
  { key: 'CORTEX_WALL_FORCE_ACTION_AT', value: '2', why: 'from the second wall of a turn the retry forces a tool call (thinking off); failure path only' },
  { key: 'CORTEX_LIFT_PLAN_SCOPE', value: 'task', why: 'task-conditioned edit-scope rule (2026-10-03): named files bind, incidental changes reverted, no file-count vetoes; inert in interactive sessions (no lift plan there)' },
  { key: 'CORTEX_MENTOR_REASONING_ALLOWANCE', value: '16000', why: 'thinking-on mentor calls get 16K reasoning tokens (flash at high truncated at 12K, cell-m-r1); only sizes a call the shipped config already makes' },
];
export const STANDARD_LEVERS: ReadonlyArray<ProfileLever> = [...BENCH_LITE_LEVERS, ...STANDARD_EXTRA_LEVERS];

/** The Terminal-Bench 4.0 cell bundle, library side (.bench/vm/STANDARD_BUNDLE.env + the resolver-cell arm env, 2026-10-14..16).
 *  The TB2_* ADAPTER chain levers have no library equivalent; the library chain (CORTEX_SECOND_ATTEMPT) stands in for it. */
export const BENCH_TB4_EXTRA_LEVERS: ReadonlyArray<ProfileLever> = [
  { key: 'CORTEX_ACTION_EFFORT', value: 'high', why: 'bench action effort' },
  { key: 'MENTORSHIP_HELPER_MODEL', value: 'deepseek-v4-pro', why: 'bench mentor = the stronger DeepSeek tier (pro elder +1 engaged vs flash peer -2, m88)' },
  { key: 'CORTEX_MENTOR_REASONING', value: 'on', why: 'bench mentor thinks' },
  { key: 'CORTEX_MENTOR_REASONING_ALLOWANCE', value: '60000', why: 'bench mentor reasoning allowance (pro)' },
  { key: 'CORTEX_MENTOR_THINKING_TIMEOUT_MS', value: '1000000', why: 'bench mentor thinking timeout' },
  { key: 'CORTEX_ENDTURN_RESOLVER_MODEL', value: 'deepseek-flash', why: 'bench judge/resolver on flash (the cells named the retired alias deepseek-v4-flash; same served model)' },
  { key: 'CORTEX_ENDTURN_RESOLVER_REASONING', value: 'none', why: 'bench resolver thinking off (one thinking-on re-judge on a gap stays)' },
  { key: 'CORTEX_ENDTURN_TIER', value: 'essential', why: 'EndTurn in the turn-1 tool set' },
  { key: 'CORTEX_JUDGE_EVIDENCE_MAX_VETOES', value: '3', why: 'arm B veto cap (TB4-class budgets only; costs passes on < 40-min tasks)' },
  { key: 'CORTEX_LIFT_PLAN_BUDGET_TOKENS', value: '6000', why: 'bench planner output budget' },
  { key: 'CORTEX_LIFT_PLAN_DOCTRINE', value: 'v1', why: 'bench planner doctrine' },
  { key: 'CORTEX_LIFT_PLAN_TIMEOUT_MS', value: '1000000', why: 'bench planner timeout' },
  { key: 'CORTEX_TURN_STATUS', value: 'auto', why: 'arm B STATUS line (needs a turn deadline)' },
  { key: 'CORTEX_INVENTORY', value: '1', why: 'bench workspace inventory in the steering env report' },
  { key: 'CORTEX_ORIENT_BASELINE', value: '1', why: 'bench checksum baseline + pre-finish revert line' },
  { key: 'CORTEX_WORKSPACE_CLEAN', value: '1', why: 'bench: nothing the harness writes lands in the task tree' },
  { key: 'CORTEX_PID1_GUARD', value: 'on', why: 'bench container PID 1 note' },
  { key: 'CORTEX_PLATEAU_STOP', value: 'status', why: 'bench plateau metric line' },
  { key: 'CORTEX_VERIFY_SCALE', value: 'on', why: 'bench judge rubric: verify at scale' },
  { key: 'CORTEX_RULE_INPUTS', value: 'on', why: 'bench task rule L1' },
  { key: 'CORTEX_RULE_INTERP', value: 'on', why: 'bench task rule L2' },
  { key: 'CORTEX_RULE_HOLDOUT', value: 'on', why: 'bench task rule L3' },
  { key: 'CORTEX_RULE_INDEP', value: 'on', why: 'bench task rule L4' },
  { key: 'CORTEX_OUTPUT_CAP_TOKENS', value: '65536', why: 'bench per-call output cap' },
  { key: 'CORTEX_MEETS_CONFIRM', value: 'false', why: 'bench: no MEETS confirm hold' },
  { key: 'CORTEX_SECOND_ATTEMPT', value: '1', why: 'library second-attempt chain (the cells used the adapter chain; library chain = mechanism parity, outcome gap open)' },
  { key: 'CORTEX_SECOND_ATTEMPT_MAX', value: '2', why: 'chain max attempts' },
  { key: 'CORTEX_SECOND_ATTEMPT_TRIGGER', value: 'accept-with-gap,accept-low-confidence,accept,none', why: 'widened trigger (promoted 4.124.68)' },
  { key: 'CORTEX_GIT_CONTEXT', value: 'false', why: 'bench hygiene' },
  { key: 'CORTEX_SLASH_COMMAND_HINT', value: 'false', why: 'bench hygiene' },
  { key: 'ENABLE_WEBTOOLS', value: 'false', why: 'bench: no web surface' },
];
export const BENCH_TB4_LEVERS: ReadonlyArray<ProfileLever> = (() => {
  const extra = new Map(BENCH_TB4_EXTRA_LEVERS.map((l) => [l.key, l]));
  // bench values override a standard value for the same key (allowance 60000 over 16000)
  return [...STANDARD_LEVERS.filter((l) => !extra.has(l.key)), ...BENCH_TB4_EXTRA_LEVERS];
})();

/** USER PROFILES (2026-11-12, operator: "user installs of the library should have a different lever stack than the bench harness … they
 *  need web_tools and mcp's active and the tools that are excluded for the bench runs" and "the 3 tools-only+guards / hybrid / standard + MCP
 *  and web profiles [should] be fixed when set" while every other lever stays mutable). Evidence: holdout-8 (.bench/eval/om2w, 11-05/06) —
 *  models driving the tools directly ~1 min/task vs 6.5–9.8 min/task through `standard` (planner + judge reviews + Browse delegate), which
 *  lifted deepseek-flash 4/8 → 7/8 (audited). All three keep the Bash+Edit turn-1 frame and its tool lift (operator: "the bash+edit narrow
 *  frame is fine"), the failure-path guards, MCP tools injected and web tools on, and NO second attempt (3x cost, the selector loses ~8
 *  passes/arm on TB4). LOCKED: a user profile's levers win over values that came from .env FILES (e.g. a stale full-ledger
 *  ~/.cortex/.env); the real process environment and .env.local still win (explicit, per-launch overrides). Levers a profile does not name
 *  stay mutable. The bench never uses these: the Harbor adapter pins `standard` when an arm names no profile. */
export const USER_GUARD_LEVERS: ReadonlyArray<ProfileLever> = [
  { key: 'CORTEX_LOOP_TOOL_BLOCK', value: 'true', why: 'guard: a detected tool loop is blocked + redirected' },
  { key: 'CORTEX_EMPTY_TURN_CONTINUE', value: 'true', why: 'guard: an empty reasoning-only turn continues with tools' },
  { key: 'CORTEX_NEARDUP_BREAKER', value: 'true', why: 'guard: near-duplicate retry loops are broken' },
  { key: 'CORTEX_POLL_GUARD', value: 'true', why: 'guard: busy-wait polling nudge' },
  { key: 'CORTEX_SURRENDER_NUDGE', value: 'true', why: 'guard: a finish that lists remaining steps is told to execute them' },
  { key: 'CORTEX_BASH_PIPEFAIL', value: 'true', why: 'guard: a failing command in a pipe is a failure' },
  { key: 'MAX_CONSECUTIVE_ERRORS', value: '6', why: 'guard: three failing diagnostic probes are normal debugging' },
  { key: 'CORTEX_WALL_DROP', value: 'on', why: 'reasoning-exhaustion wall recovery (failure path only)' },
  { key: 'CORTEX_WALL_SUMMARY', value: 'on', why: 'reasoning-exhaustion wall recovery (failure path only)' },
  { key: 'CORTEX_REASONING_EXHAUST_BACKOFF', value: 'false', why: 'keeps the effort (cache key) after a wall' },
  { key: 'CORTEX_WALL_RETRY_LADDER', value: '65536,16384', why: 'reasoning-exhaustion wall: smaller max_tokens retry rungs' },
  { key: 'CORTEX_WALL_FORCE_ACTION_AT', value: '2', why: 'from the second wall the retry forces a tool call' },
  { key: 'CORTEX_OUTER_TOOL_TIMEOUT_MS', value: '600000', why: 'outer per-batch tool abort floor (long builds are not killed)' },
];
export const USER_SURFACE_LEVERS: ReadonlyArray<ProfileLever> = [
  { key: 'MCP_AUTO_INJECT', value: 'true', why: 'tools of the MCP servers a user connects reach the model (the bench keeps false)' },
  { key: 'ENABLE_WEBTOOLS', value: 'true', why: 'web search/fetch on regardless of key detection (the bench pins false)' },
  { key: 'CORTEX_TOOL_ANCHOR', value: 'bash-edit', why: 'Bash+Edit turn-1 frame, lifted to the full tool set after the first action' },
  { key: 'CORTEX_SECOND_ATTEMPT', value: '0', why: 'no second attempt (3x cost; selection loses passes)' },
  { key: 'CORTEX_SUBAGENT_ENDTURN', value: 'mechanical', why: 'no judge review inside sub-agents' },
];
const JUDGE_ON: ReadonlyArray<ProfileLever> = [
  { key: 'CORTEX_ENDTURN_RESOLVER', value: 'true', why: 'second-model finish review (resolver-k5 +17pp)' },
  { key: 'CORTEX_ENDTURN_RESOLVER_ABSTAIN', value: 'true', why: 'the judge may retire a task it cannot close (same passes, ~30% cheaper)' },
  { key: 'CORTEX_ENDTURN_RESOLVER_REASONING', value: 'none', why: 'thinking-on judges false-accept 50–56% vs ~20% thinking-off (cell-n-r1)' },
  { key: 'CORTEX_MENTOR_REASONING', value: 'none', why: 'planner/mentor thinking off: thinking-on lost on the hard core (cell-n-r1/r3) and costs 50–75 s per call' },
  { key: 'CORTEX_LIFT_PLAN', value: 'true', why: 'one plan of attack after the first tool result' },
  { key: 'CORTEX_LIFT_PLAN_INTERACTIVE', value: 'true', why: 'the plan also runs in human-driven sessions (operator: the frame gets a plan and a tool lift)' },
];
const BROWSER_DIRECT: ReadonlyArray<ProfileLever> = [
  { key: 'CORTEX_BROWSE_TOOL', value: 'off', why: 'no Browse delegate: the main model drives the browser tools itself (the delegate was most of the holdout-8 time)' },
  { key: 'CORTEX_MCP_AUTOCONNECT', value: 'nexus-browser', why: 'browser tools in the main session from turn 1 (local library or hosted MCP, per NEXUS_BROWSER_MODE)' },
];
/** user-fast = tools-only + guards: the model and its tools, every reviewer off. */
export const USER_FAST_LEVERS: ReadonlyArray<ProfileLever> = [
  ...USER_GUARD_LEVERS, ...USER_SURFACE_LEVERS, ...BROWSER_DIRECT,
  { key: 'CORTEX_ENDTURN_RESOLVER', value: 'false', why: 'no finish review' },
  { key: 'CORTEX_ENDTURN_GATE', value: 'false', why: 'no mandatory EndTurn attestation' },
  { key: 'CORTEX_ENDTURN_REQUIREMENTS', value: 'false', why: 'no requirements attestation' },
  { key: 'CORTEX_ENDTURN_INTEGRITY', value: 'false', why: 'no sources/integrity attestation' },
  { key: 'CORTEX_SCOPE_CHECK', value: 'off', why: 'no scope hold' },
  { key: 'CORTEX_LIFT_PLAN', value: 'false', why: 'no planner call' },
  { key: 'CORTEX_LIFT_NUDGE', value: 'false', why: 'no lift reminder' },
  { key: 'MENTORSHIP_ENABLED', value: 'false', why: 'no mentor helper model' },
  { key: 'CORTEX_DEADLINE_EXIT_MENTOR', value: 'false', why: 'no deadline mentor call' },
];
/** user-hybrid = tools-only speed on web turns (browser in the main session, no judge on web-evidenced finishes) + the measured reviewers on
 *  code/file work (plan of attack, judge with abstain, EndTurn gate as shipped). */
export const USER_HYBRID_LEVERS: ReadonlyArray<ProfileLever> = [
  ...STANDARD_LEVERS.filter((l) => !USER_GUARD_LEVERS.some((g) => g.key === l.key)), ...USER_GUARD_LEVERS, ...USER_SURFACE_LEVERS, ...BROWSER_DIRECT, ...JUDGE_ON,
  { key: 'CORTEX_ENDTURN_RESOLVER_WEB', value: 'off', why: 'no judge review of a web-evidenced finish (web results read, no file writes)' },
];
/** user-careful = standard + MCP + web: the full measured pipeline (Browse delegate, judge on every tool-using finish, plan of attack). */
export const USER_CAREFUL_LEVERS: ReadonlyArray<ProfileLever> = [
  ...STANDARD_LEVERS.filter((l) => !USER_GUARD_LEVERS.some((g) => g.key === l.key)), ...USER_GUARD_LEVERS, ...USER_SURFACE_LEVERS, ...JUDGE_ON,
];
/** Profiles whose levers are LOCKED once selected (win over .env file values; real env + .env.local still win). */
export const LOCKED_PROFILES: ReadonlySet<InteractiveProfileName> = new Set(['user-fast', 'user-hybrid', 'user-careful']);

/** 'container' = the hosted sandbox images' pre-existing CORTEX_PROFILE value (a preconfigured one-shot marker, no reader until 4.125.0);
 *  it means the shipped set there, so it resolves to `standard` — otherwise every hosted MCP / autoresearch session silently ran `off`. */
const ALIASES: Readonly<Record<string, InteractiveProfileName>> = { container: 'standard' };
const KNOWN: ReadonlySet<string> = new Set(['off', 'bench-lite', 'standard', 'bench-tb4', 'tools-only', 'user-fast', 'user-hybrid', 'user-careful']);

/** Profile name from CORTEX_PROFILE, else the legacy CORTEX_INTERACTIVE_PROFILE. Unset / blank / unknown → off (an unknown name never arms anything). */
export function resolveInteractiveProfileName(env: NodeJS.ProcessEnv = process.env): InteractiveProfileName {
  const raw = (env[PROFILE_ENV] ?? '').trim() || (env[LEGACY_PROFILE_ENV] ?? '').trim();
  const v = raw.toLowerCase();
  if (v in ALIASES) return ALIASES[v]!;
  return KNOWN.has(v) ? (v as InteractiveProfileName) : 'off';
}

/** Session kinds a profile applies to: bench-lite = interactive only (legacy); standard / bench-tb4 = every session. */
export function profileAppliesTo(name: InteractiveProfileName, interactive: boolean): boolean {
  if (name === 'off') return false;
  if (name === 'bench-lite') return interactive;
  return true;
}

/** Same test as the orchestrator's approval-mode default: both stdin and stdout are TTYs. */
export function isInteractiveSession(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout,
): boolean {
  return stdin?.isTTY === true && stdout?.isTTY === true;
}

export function profileLevers(name: InteractiveProfileName): ReadonlyArray<ProfileLever> {
  if (name === 'bench-lite') return BENCH_LITE_LEVERS;
  if (name === 'standard') return STANDARD_LEVERS;
  if (name === 'bench-tb4') return BENCH_TB4_LEVERS;
  if (name === 'tools-only') return TOOLS_ONLY_LEVERS;
  if (name === 'user-fast') return USER_FAST_LEVERS;
  if (name === 'user-hybrid') return USER_HYBRID_LEVERS;
  if (name === 'user-careful') return USER_CAREFUL_LEVERS;
  return [];
}

export interface InteractiveProfileResolution {
  name: InteractiveProfileName;
  interactive: boolean;
  /** Levers the profile fills (key → value). Empty when off / headless. */
  apply: Record<string, string>;
  /** Profile levers left alone because the user set them. */
  explicit: string[];
  /** LOCKED profiles: levers whose .env-file value the profile replaced (shown in the effective-config dump). */
  lockedOver?: string[];
}

const isSet = (v: string | undefined): boolean => v !== undefined && v.trim() !== '';

/** Pure: what the profile WOULD set, given the env and the session kind. Never mutates. */
export function resolveInteractiveProfile(
  env: NodeJS.ProcessEnv,
  opts: { interactive: boolean },
  /** Profile name when env does not carry one (the shipped `.env.defaults` value, read before that file is applied). */
  fallbackName?: string,
  /** Keys present in the REAL process environment before any .env file was applied. For a LOCKED profile only these count as explicit;
   *  values that came from .env files are overridden. Omitted = every set key counts as explicit (the unlocked behaviour). */
  realEnvKeys?: ReadonlySet<string>,
): InteractiveProfileResolution {
  const named = (env[PROFILE_ENV] ?? '').trim() !== '' || (env[LEGACY_PROFILE_ENV] ?? '').trim() !== '';
  const name = resolveInteractiveProfileName(!named && fallbackName !== undefined ? { [PROFILE_ENV]: fallbackName } : env);
  const out: InteractiveProfileResolution = { name, interactive: opts.interactive, apply: {}, explicit: [] };
  if (!profileAppliesTo(name, opts.interactive)) return out;
  const locked = LOCKED_PROFILES.has(name) && realEnvKeys !== undefined;
  for (const l of profileLevers(name)) {
    const explicit = locked ? (realEnvKeys!.has(l.key) && isSet(env[l.key])) : isSet(env[l.key]);
    if (explicit) out.explicit.push(l.key);
    else {
      if (locked && isSet(env[l.key]) && env[l.key] !== l.value) (out.lockedOver ??= []).push(l.key);
      out.apply[l.key] = l.value;
    }
  }
  return out;
}

/** Fills the profile's levers into `env` (unset ones only) and records them in CORTEX_INTERACTIVE_PROFILE_APPLIED.
 *  Off / headless / nothing to fill → env untouched. Idempotent: a second call finds the keys set and adds nothing. */
export function applyInteractiveProfile(
  env: NodeJS.ProcessEnv,
  opts: { interactive: boolean },
  fallbackName?: string,
  realEnvKeys?: ReadonlySet<string>,
): InteractiveProfileResolution {
  const r = resolveInteractiveProfile(env, opts, fallbackName, realEnvKeys);
  if (r.lockedOver?.length) env.CORTEX_PROFILE_LOCKED_OVER = r.lockedOver.join(',');
  const keys = Object.keys(r.apply);
  if (keys.length === 0) return r;
  for (const k of keys) env[k] = r.apply[k];
  const prior = (env.CORTEX_INTERACTIVE_PROFILE_APPLIED ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  env.CORTEX_INTERACTIVE_PROFILE_APPLIED = [...new Set([...prior, ...keys])].join(',');
  return r;
}

/** Keys the profile filled in this process (for the effective-config `profile` source label). */
export function profileAppliedKeys(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.CORTEX_INTERACTIVE_PROFILE_APPLIED ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * The lift-plan session gate (was inline at CortexOrchestrator.deliverLiftPlanAtLift). Headless/one-shot/bench
 * (autoApproveActions) always plans; an interactive session plans only with CORTEX_LIFT_PLAN_INTERACTIVE=true.
 * The gate reads the same env the profile fills, so a profile row for CORTEX_LIFT_PLAN_INTERACTIVE would open it;
 * bench-lite deliberately has none (NEEDS-ADAPTATION — see BENCH_LITE_DEFERRED). Behaviour identical to the old
 * inline check.
 */
export function liftPlanAllowedInSession(autoApproveActions: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return autoApproveActions || env.CORTEX_LIFT_PLAN_INTERACTIVE === 'true';
}
