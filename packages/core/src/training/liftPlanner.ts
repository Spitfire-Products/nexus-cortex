/**
 * liftPlanner — the mentor-as-bounded-planner logic (LIFT_MENTOR_PLANNER_EXPERIMENT_SPEC).
 *
 * Pure, unit-testable core of the lift-boundary planner: the planner system prompt and the
 * user-prompt builder. The off-main model call (via HelperModelMiddleware.generateTaskPlan) and
 * the at-lift delivery (CortexOrchestrator.deliverLiftPlanAtLift) are the orchestrator's
 * integration; everything here is deterministic.
 *
 * WHY (spec §1-§2): the narrow-door action model produces pure action (Bash 3232× / Skill 1× /
 * consult 1× in ~4500 calls) with zero planning — it (a) grinds hard tasks to the wall without
 * converging and (b) writes its OWN tests, passes them, declares victory while the hidden grader
 * fails. At the anchor-LIFT boundary (after its first action, so a real env observation exists) a
 * bounded max-reasoning mentor plans the task ONCE and hands a criteria-anchored step plan back.
 * The main model stays narrow — the overthinking is quarantined in the mentor's single bounded
 * call (v1 is single-shot; a token cap would truncate DeepSeek mid-thought, so v1 is bounded by
 * the output budget, not a token/turn cap — see spec §2.4). Sibling of mentorConsult.ts.
 */

/** R188 (2026-09-23): the task text is the spec — 25 of 64 TB4.0 tasks exceed 2000 chars and 14 exceed 2500; every steerer sees the whole text up to this cap. */
export const TASK_TEXT_CAP = 8000;

export interface LiftPlanConfig {
  /**
   * Output token budget for the planner call. 🔴 At MAX reasoning the pro model spends the whole
   * budget on reasoning_content and returns an EMPTY answer if the budget is too small (isolated
   * eval 2026-09-04: max+1200 = 0 chars; max+4000 = a clean 2727-char plan). The budget must hold
   * BOTH the reasoning AND the plan — 4000 is the empirically-safe default. Never token-cap tighter.
   */
  outputBudgetTokens: number;
  /**
   * Reasoning effort for the planner. Default 'max': the pro CARD ships 'medium' (max over-
   * deliberated when pro was the ACTING agent grinding on solvable tasks), but a bounded single-shot
   * planner CANNOT grind, so max is safe here and produced a markedly better plan in the eval
   * (criteria-anchored + adversarial). This is the one place max reasoning is both safe and desired.
   */
  effort: string;
  /** Timeout (ms) for the orchestrator-side environment recon that feeds the planner. Bounded so a
   *  slow box can't stall the lift; fail-open to an empty report. */
  reconTimeoutMs: number;
  /** R171 HB-LIFT-PLAN-TOOL-LOOP (2026-09-18; the spec's §2.2 v2 "adaptive tool-using planner", built the R170 way — a
   *  harness-driven text protocol over the single-shot helper call). With toolRounds > 1 the planner may answer
   *  `INVESTIGATE` + `CHECK: <read-only cmd>` / `READ: <path>[:a-b]` lines instead of a plan; the harness runs them,
   *  appends an EVIDENCE block and asks again; the last round withdraws the option. Bounded by rounds + toolRoundBudgetMs
   *  (aggregate wall clock) — a turn cap, never a token cap (spec §2.4). Default 1 = single-shot, byte-identical. */
  toolRounds: number;
  toolRoundBudgetMs: number;
}

const DEFAULTS: LiftPlanConfig = { outputBudgetTokens: 4000, effort: 'max', reconTimeoutMs: 8000, toolRounds: 1, toolRoundBudgetMs: 240_000 };

export function resolveLiftPlanConfig(env: NodeJS.ProcessEnv = process.env): LiftPlanConfig {
  const n = parseInt((env.CORTEX_LIFT_PLAN_BUDGET_TOKENS ?? '').trim(), 10);
  const e = (env.CORTEX_LIFT_PLAN_EFFORT ?? '').trim();
  const r = parseInt((env.CORTEX_LIFT_PLAN_RECON_TIMEOUT_MS ?? '').trim(), 10);
  const tr = parseInt((env.CORTEX_LIFT_PLAN_TOOL_ROUNDS ?? '').trim(), 10);
  const trb = parseInt((env.CORTEX_LIFT_PLAN_TOOL_ROUND_BUDGET_MS ?? '').trim(), 10);
  return {
    outputBudgetTokens: Number.isInteger(n) && n > 0 ? n : DEFAULTS.outputBudgetTokens,
    effort: e || DEFAULTS.effort,
    reconTimeoutMs: Number.isInteger(r) && r > 0 ? r : DEFAULTS.reconTimeoutMs,
    toolRounds: Number.isInteger(tr) && tr >= 1 ? Math.min(5, tr) : DEFAULTS.toolRounds,
    toolRoundBudgetMs: Number.isInteger(trb) && trb >= 10_000 ? Math.min(1_800_000, trb) : DEFAULTS.toolRoundBudgetMs,
  };
}

/**
 * The environment recon the orchestrator runs (bounded, read-only) right before the planner call, so
 * the planner ALWAYS plans against the box's REAL resources — not just whatever the model's first
 * action happened to observe. Reports: tooling (interpreters/compilers/fast-installers present),
 * installed Python packages (so the planner knows if e.g. torch is missing), disk/mem, the real test
 * files, and the workspace listing. POSIX sh, every leg fail-soft (`2>/dev/null`, `head`-bounded).
 */
export const ENV_RECON_COMMAND =
  'echo "== TOOLING (present) =="; ' +
  'for i in python3 python node npm cc gcc g++ make cargo go uv bun pip pip3 git curl; do ' +
  'command -v "$i" >/dev/null 2>&1 && echo "  $i=$(command -v "$i")"; done; ' +
  'echo "== PYTHON PACKAGES (installed, top 40) =="; ' +
  '{ python3 -m pip list 2>/dev/null || pip list 2>/dev/null || pip3 list 2>/dev/null; } | head -40; ' +
  'echo "== NODE (global top-level) =="; npm ls -g --depth 0 2>/dev/null | head -20; ' +
  'echo "== RESOURCES =="; df -h . 2>/dev/null | tail -1; free -m 2>/dev/null | sed -n "2p"; ' +
  'echo "== TEST FILES / BUILD =="; ' +
  'find . -maxdepth 4 \\( -iname "*test*" -o -name "Makefile" -o -name "*.proto" -o -name "conftest.py" \\) ' +
  '2>/dev/null | grep -v node_modules | head -25; ' +
  // 2026-09-23 (L7/L8: the ledger extractor guessed a checker's CLI in 6/6 photonic sessions and every run of that check was a false
  // failure): show the USAGE of any checker/verifier/validator/grader script the task ships, so nothing downstream has to guess it.
  'echo "== CHECKER / VERIFIER SCRIPTS (usage lines) =="; ' +
  'for f in $(find . -maxdepth 3 \\( -iname "*check*" -o -iname "*verif*" -o -iname "*validat*" -o -iname "*grade*" \\) ' +
  '\\( -name "*.py" -o -name "*.sh" \\) 2>/dev/null | grep -v node_modules | head -6); do echo "-- $f"; ' +
  '{ grep -n -m4 -iE "usage|^ *Run:|add_argument|sys\\.argv|getopts" "$f" 2>/dev/null; sed -n "1,30p" "$f" 2>/dev/null | grep -iE -m3 "(python3?|bash|sh) +[^ ]*(check|verif|validat|grade)"; } | head -6 | cut -c1-160; done; ' +
  'echo "== WORKSPACE =="; ls -1A 2>/dev/null | head -30';

/**
 * The planner system prompt — the 3-part adversarial-planner role (spec §2.3). HINTS the junior
 * toward the REAL criteria and a concrete plan; the junior does the work. Explicitly targets the
 * two measured failure classes: grind-to-wall and self-graded-success (criteria-misalignment).
 */
/**
 * CORTEX_LIFT_PLAN_DOCTRINE=v2 (4.107.2): the four census-traced bullets added in 4.107.1 (ONE INSTALL LAYER, LONG
 * WAITS, EXACT-OUTPUT, EXPECTED LITERALS ARE LAW). v1 (default) = the 4.107.0 prompt without them. A lever because
 * 4.107.1 shipped them together with the EndTurn tier change and the hard core regressed (11/26 → 4/18); the 2×2
 * (cell-n-r6) attributes the regression. Prompt-only; no runtime cost difference.
 */
export const DOCTRINE_V2 =
  '- ONE INSTALL LAYER, no redundant stacks: the box\'s budget is finite, so plan the cheapest toolchain ' +
  'that reaches the real criteria and reuse whatever the report shows PRESENT. Never stack the same ' +
  'capability twice (system python, then a .venv, then a second interpreter inside it; a global npm plus ' +
  'a per-project node; conda on top of pip). One layer: `uv` owns the venv AND the packages (`uv venv`, ' +
  '`uv pip install`, or `uv run`), `bun` owns JS deps, or use the interpreter already present with ' +
  'pip/npm directly. Install only what a step needs — no full IDE/toolchain bundles for a single ' +
  'library, and no reinstalling something the report already lists.\n' +
  '- LONG WAITS: never `sleep` for minutes inside one command (training, servers, big builds) — run it in ' +
  'the background or with a matched timeout and poll its output in short checks (<= 60 s per wait), so the ' +
  'budget is spent on progress, not idling.\n' +
  '- EXACT-OUTPUT tasks: when the criteria say the output must be byte-identical or formatting preserved, ' +
  'plan a byte-level transform on the raw text — NEVER a parse-then-re-serialize round trip, which silently ' +
  'normalizes whitespace, quotes, key order, or numbers.\n' +
  '- EXPECTED LITERALS ARE LAW: an exact string, value, path, or filename stated by the task or its tests is ' +
  'used verbatim — never "corrected" (spelling, casing, leetspeak, units). Assume the hidden grader ' +
  're-parameterizes (another seed, size, input file, working dir): derive results from the inputs at run ' +
  'time, never bake constants observed in one run, and resolve paths from the task\'s stated locations.\n';

/** The planner system prompt WITH the v2 doctrine bullets. */
export const PLANNER_SYSTEM =
  'You are a senior engineer writing a battle-tested plan of attack for a junior agent that will ' +
  'execute it in a real terminal container. The junior acts in small steps and plans poorly — it ' +
  'tends to (a) grind endlessly on hard tasks without converging, and (b) write its OWN tests, ' +
  'pass them, and declare victory while the REAL hidden grader fails. Do three things:\n' +
  '1. ADVERSARIAL ANALYSIS: read the task and name the nuances, edge constraints, and the specific ' +
  'ways a naive attempt fails THIS task.\n' +
  '2. CONFIRM THE REAL CRITERIA: state precisely what the hidden grader will check — a provided ' +
  'test file, a required run command, an exact output/format. The junior\'s OWN tests are a means, ' +
  'NEVER the finish line; the plan must verify against the task\'s real criteria.\n' +
  '3. PLAN or RETIRE: emit a concise NUMBERED step-by-step plan that front-loads finding and ' +
  'reading the real tests/criteria, then builds to them, then verifies against them. If the task ' +
  'is beyond a small agent\'s reach within budget, emit a RETIRE plan instead: attempt the minimal ' +
  'viable skeleton, run the real test once, submit best-effort, and STOP — do not grind.\n' +
  'USE THE ENVIRONMENT REPORT (tooling present, installed packages, resources, test files) you are ' +
  'given:\n' +
  '- If the task needs a language, tool, or package that the report shows is MISSING, add an explicit ' +
  'INSTALL step — prefer a fast cached installer (uv for Python, bun/npm for JS), pin the version, and ' +
  'verify with a real run. An empty/bare box is part of the task, not an error.\n' +
  DOCTRINE_V2 +
  '- If a step is long-running (a build, a large install, training, a big test suite), tell the junior ' +
  'to set an adequate Bash timeout for THAT command (e.g. timeout: 600000 ms — the harness honors up to ' +
  '600000ms; anything left at the default is backgrounded at ~120s). Match the timeout to the step.\n' +
  'Output ONLY the plan the junior will follow: a short numbered list of concrete, criteria-anchored ' +
  'actions. Be specific and terse. Do not write the full solution or long code blocks.';

/** The 4.107.0 planner system prompt (no v2 doctrine bullets). */
export const PLANNER_SYSTEM_V1 = PLANNER_SYSTEM.replace(DOCTRINE_V2, '');

/** R171: offered while investigation rounds remain — the planner may look before it plans. */
export const PLANNER_INVESTIGATE_CLAUSE =
  '\n\nYou may INVESTIGATE before planning: if the report and observations do not show what you need — the real test file, the ' +
  'grader\'s entry point, an input format, a config, what a tool actually prints — answer with the first line `INVESTIGATE` ' +
  'followed by up to three `CHECK: <read-only command>` lines (ls / cat / head / grep / a test runner in list mode; the harness ' +
  'runs them from the workspace root) and up to three `READ: <path>[:START-END]` lines (a file, optionally a line range). The ' +
  'harness runs them and shows you an EVIDENCE block, then asks again. Prefer reading the real tests and criteria over guessing them.';
/** R171: on the last round the option is withdrawn — plan now on what has been gathered. */
export const PLANNER_DECIDE_NOW_CLAUSE =
  '\n\nNo further investigation is available — write the plan now on the evidence you have (INVESTIGATE is no longer accepted).';

/** Select the planner persona by CORTEX_LIFT_PLAN_DOCTRINE ('v2' → bullets on; anything else → v1 baseline); R171 `investigate`
 *  = 'offer' while rounds remain, 'withdraw' on the last round of a multi-round plan, undefined for the single-shot default. */
export function plannerSystem(env: NodeJS.ProcessEnv = process.env, investigate?: 'offer' | 'withdraw'): string {
  const base = (env.CORTEX_LIFT_PLAN_DOCTRINE || '').trim().toLowerCase() === 'v2' ? PLANNER_SYSTEM : PLANNER_SYSTEM_V1;
  return investigate === 'offer' ? base + PLANNER_INVESTIGATE_CLAUSE : investigate === 'withdraw' ? base + PLANNER_DECIDE_NOW_CLAUSE : base;
}

/** R171: what the planner answered — a plan, or an investigation request (only honored while rounds remain). */
export interface PlannerResponse {
  investigate: boolean;
  /** `CHECK: <cmd>` lines (deduped, ≤4, backticks stripped). */
  checks: string[];
  /** `READ: <path>[:a-b]` lines (deduped, ≤4). */
  reads: string[];
  /** The plan text when not investigating (the raw response, trimmed). */
  plan: string;
}
export function parsePlannerResponse(text: string): PlannerResponse {
  const t = (text || '').trim();
  const first = t.split('\n').find((l) => l.trim()) ?? '';
  const investigate = /^\s*(?:[-*#>]+\s*)?(?:VERDICT:\s*)?INVESTIGATE\b/i.test(first);
  const checks: string[] = []; const reads: string[] = [];
  if (investigate) {
    for (const line of t.split('\n')) {
      const cl = line.match(/^\s*(?:[-*\d.)]+\s*)?CHECK:\s*(.+?)\s*$/i);
      if (cl) { const cmd = cl[1]!.replace(/^`+|`+$/g, '').trim(); if (cmd && cmd.length <= 400 && !checks.includes(cmd)) checks.push(cmd); continue; }
      const rl = line.match(/^\s*(?:[-*\d.)]+\s*)?READ:\s*(.+?)\s*$/i);
      if (rl) { const spec = rl[1]!.replace(/^`+|`+$/g, '').trim(); if (spec && spec.length <= 300 && !reads.includes(spec)) reads.push(spec); }
    }
  }
  return { investigate, checks: checks.slice(0, 4), reads: reads.slice(0, 4), plan: investigate ? '' : t };
}

export interface LiftPlanContext {
  /** The task statement (the instruction the agent received). */
  task: string;
  /** What the agent has observed so far — its first action(s) and their output at the lift. */
  observations: string;
  /** Orchestrator-gathered environment report (ENV_RECON_COMMAND output): tooling present, installed
   *  packages, resources, test files. Lets the planner steer installs + timeouts accurately. */
  envReport?: string;
  /** R171: EVIDENCE blocks from earlier investigation rounds of THIS planning call (oldest first). */
  evidenceRounds?: string[];
}

/**
 * Build the user prompt sent to the planner. Bounded slices keep the call cheap and cache-stable.
 */
export function buildPlannerUserPrompt(ctx: LiftPlanContext, investigate?: 'offer' | 'withdraw'): string {
  const parts: string[] = [];
  parts.push(`TASK:\n${(ctx.task || '').trim().slice(0, TASK_TEXT_CAP)}`);
  const env = (ctx.envReport || '').trim();
  if (env) {
    parts.push(`ENVIRONMENT REPORT (what is actually on this box — tooling, installed packages, resources, tests):\n${env.slice(0, 3000)}`);
  }
  const obs = (ctx.observations || '').trim();
  if (obs) {
    parts.push(`WHAT THE AGENT HAS OBSERVED SO FAR (its first action + output):\n${obs.slice(0, 2000)}`);
  }
  for (const ev of ctx.evidenceRounds ?? []) { const e = (ev || '').trim(); if (e) parts.push(e.slice(0, 6000)); } // R171
  if (investigate === 'offer') {
    parts.push(
      'Decide whether you can name the REAL criteria and the first steps from what is shown. If not — the real tests, the grader ' +
        'entry point, an input/output format or a tool\'s behavior are still unknown — your first line is `INVESTIGATE`, followed by ' +
        'up to three `CHECK: <read-only command>` lines and up to three `READ: <path>[:START-END]` lines; the harness runs them and asks ' +
        'you again with the results. Otherwise produce the criteria-anchored numbered plan now (or a RETIRE plan if there is no viable ' +
        'path within budget). Steer installs/timeouts from the ENVIRONMENT REPORT. The junior will follow it verbatim.',
    );
  } else {
    parts.push(
      (investigate === 'withdraw' ? 'No further investigation is available. ' : '') +
        'Produce the criteria-anchored numbered plan now (or a RETIRE plan if there is no viable path ' +
        'within budget). Steer installs/timeouts from the ENVIRONMENT REPORT. The junior will follow it verbatim.',
    );
  }
  return parts.join('\n\n');
}
