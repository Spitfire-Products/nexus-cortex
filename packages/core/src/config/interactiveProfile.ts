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

export type InteractiveProfileName = 'off' | 'bench-lite';

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

const KNOWN: ReadonlySet<string> = new Set(['off', 'bench-lite']);

/** off | bench-lite. Unset / blank / unknown → off (an unknown name never arms anything). */
export function resolveInteractiveProfileName(env: NodeJS.ProcessEnv = process.env): InteractiveProfileName {
  const v = (env.CORTEX_INTERACTIVE_PROFILE ?? '').trim().toLowerCase();
  return KNOWN.has(v) ? (v as InteractiveProfileName) : 'off';
}

/** Same test as the orchestrator's approval-mode default: both stdin and stdout are TTYs. */
export function isInteractiveSession(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout,
): boolean {
  return stdin?.isTTY === true && stdout?.isTTY === true;
}

export function profileLevers(name: InteractiveProfileName): ReadonlyArray<ProfileLever> {
  return name === 'bench-lite' ? BENCH_LITE_LEVERS : [];
}

export interface InteractiveProfileResolution {
  name: InteractiveProfileName;
  interactive: boolean;
  /** Levers the profile fills (key → value). Empty when off / headless. */
  apply: Record<string, string>;
  /** Profile levers left alone because the user set them. */
  explicit: string[];
}

const isSet = (v: string | undefined): boolean => v !== undefined && v.trim() !== '';

/** Pure: what the profile WOULD set, given the env and the session kind. Never mutates. */
export function resolveInteractiveProfile(
  env: NodeJS.ProcessEnv,
  opts: { interactive: boolean },
  /** Profile name when env does not carry one (the shipped `.env.defaults` value, read before that file is applied). */
  fallbackName?: string,
): InteractiveProfileResolution {
  const name = resolveInteractiveProfileName(
    env.CORTEX_INTERACTIVE_PROFILE === undefined && fallbackName !== undefined ? { CORTEX_INTERACTIVE_PROFILE: fallbackName } : env,
  );
  const out: InteractiveProfileResolution = { name, interactive: opts.interactive, apply: {}, explicit: [] };
  if (name === 'off' || !opts.interactive) return out;
  for (const l of profileLevers(name)) {
    if (isSet(env[l.key])) out.explicit.push(l.key);
    else out.apply[l.key] = l.value;
  }
  return out;
}

/** Fills the profile's levers into `env` (unset ones only) and records them in CORTEX_INTERACTIVE_PROFILE_APPLIED.
 *  Off / headless / nothing to fill → env untouched. Idempotent: a second call finds the keys set and adds nothing. */
export function applyInteractiveProfile(
  env: NodeJS.ProcessEnv,
  opts: { interactive: boolean },
  fallbackName?: string,
): InteractiveProfileResolution {
  const r = resolveInteractiveProfile(env, opts, fallbackName);
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
