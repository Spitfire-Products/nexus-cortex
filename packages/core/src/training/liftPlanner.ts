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
}

const DEFAULTS: LiftPlanConfig = { outputBudgetTokens: 4000, effort: 'max', reconTimeoutMs: 8000 };

export function resolveLiftPlanConfig(env: NodeJS.ProcessEnv = process.env): LiftPlanConfig {
  const n = parseInt((env.CORTEX_LIFT_PLAN_BUDGET_TOKENS ?? '').trim(), 10);
  const e = (env.CORTEX_LIFT_PLAN_EFFORT ?? '').trim();
  const r = parseInt((env.CORTEX_LIFT_PLAN_RECON_TIMEOUT_MS ?? '').trim(), 10);
  return {
    outputBudgetTokens: Number.isInteger(n) && n > 0 ? n : DEFAULTS.outputBudgetTokens,
    effort: e || DEFAULTS.effort,
    reconTimeoutMs: Number.isInteger(r) && r > 0 ? r : DEFAULTS.reconTimeoutMs,
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
  'echo "== WORKSPACE =="; ls -1A 2>/dev/null | head -30';

/**
 * The planner system prompt — the 3-part adversarial-planner role (spec §2.3). HINTS the junior
 * toward the REAL criteria and a concrete plan; the junior does the work. Explicitly targets the
 * two measured failure classes: grind-to-wall and self-graded-success (criteria-misalignment).
 */
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
  '- If a step is long-running (a build, a large install, training, a big test suite), tell the junior ' +
  'to set an adequate Bash timeout for THAT command (e.g. timeout: 600000 ms — the harness honors up to ' +
  '600000ms; anything left at the default is backgrounded at ~120s). Match the timeout to the step.\n' +
  'Output ONLY the plan the junior will follow: a short numbered list of concrete, criteria-anchored ' +
  'actions. Be specific and terse. Do not write the full solution or long code blocks.';

export interface LiftPlanContext {
  /** The task statement (the instruction the agent received). */
  task: string;
  /** What the agent has observed so far — its first action(s) and their output at the lift. */
  observations: string;
  /** Orchestrator-gathered environment report (ENV_RECON_COMMAND output): tooling present, installed
   *  packages, resources, test files. Lets the planner steer installs + timeouts accurately. */
  envReport?: string;
}

/**
 * Build the user prompt sent to the planner. Bounded slices keep the call cheap and cache-stable.
 */
export function buildPlannerUserPrompt(ctx: LiftPlanContext): string {
  const parts: string[] = [];
  parts.push(`TASK:\n${(ctx.task || '').trim().slice(0, 2000)}`);
  const env = (ctx.envReport || '').trim();
  if (env) {
    parts.push(`ENVIRONMENT REPORT (what is actually on this box — tooling, installed packages, resources, tests):\n${env.slice(0, 3000)}`);
  }
  const obs = (ctx.observations || '').trim();
  if (obs) {
    parts.push(`WHAT THE AGENT HAS OBSERVED SO FAR (its first action + output):\n${obs.slice(0, 2000)}`);
  }
  parts.push(
    'Produce the criteria-anchored numbered plan now (or a RETIRE plan if there is no viable path ' +
      'within budget). Steer installs/timeouts from the ENVIRONMENT REPORT. The junior will follow it verbatim.',
  );
  return parts.join('\n\n');
}
