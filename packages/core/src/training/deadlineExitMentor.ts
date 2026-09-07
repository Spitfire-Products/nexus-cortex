/**
 * deadlineExitMentor — the mentor-as-deadline-checkpoint (operator design 2026-09-05, the
 * "smart deadline"). The THIRD mentor invocation (distinct from liftPlanner and
 * endTurnResolver). At the WARN rung (~0.81 of the task budget, where residual still exists),
 * instead of a dumb "wrap up" nudge to the junior, a bounded mentor looks at the work product
 * and the remaining budget and decides ONE thing:
 *
 *   CONTINUE — on-track / closing in (like schemelike, which solves in the last fifth) → let it
 *              run to the hard-floor break; do NOT truncate a win.
 *   FINISH   — the work ALREADY meets the task's real criteria → end now with an attestation,
 *              bypassing the EndTurn resolver (no double pro@max pay).
 *   ACTION   — a small, specific gap remains and the ONE minimal action to close it fits the
 *              residual → inject that action, then finish.
 *   RETIRE   — stuck / structurally unclosable in the residual (like filter-js grinding) → end
 *              CLEANLY now, do not burn the residual on a lost cause.
 *
 * 🔴 WHY smart, not a slid number (resolver-k5): 24% of PASSING rows finish at ≥0.80 of budget —
 * a flat earlier deadline would truncate a quarter of wins. The mentor's job is to tell
 * "closing in" from "grinding". Value is GATED on that judgment (an early checkpoint that
 * mis-calls a closing-in task HURTS), so this ships DARK and is A/B-validated. Pure + testable;
 * the hard-floor break rung stays as the unconditional failsafe underneath.
 */

export interface DeadlineExitConfig {
  /** Master switch: CORTEX_DEADLINE_EXIT_MENTOR. Dark by default. */
  enabled: boolean;
  effort: string;
  /** Absolute cap on the mentor's own output budget (tokens). Actual budget is the MIN of this
   *  and a residual-scaled value (a fraction of the remaining wall-clock) so the checkpoint can
   *  never eat the residual it is trying to preserve. */
  outputBudgetTokensCap: number;
  /** Absolute cap on the mentor call timeout (ms). Residual-scaled at the call site. */
  timeoutMsCap: number;
  /** Fraction of the residual (remaining ms) the checkpoint call may spend. */
  residualFrac: number;
}

const DEFAULTS: DeadlineExitConfig = {
  enabled: false,
  effort: 'max',
  outputBudgetTokensCap: 2000,
  timeoutMsCap: 45000,
  residualFrac: 0.4,
};

export function resolveDeadlineExitConfig(env: NodeJS.ProcessEnv = process.env): DeadlineExitConfig {
  const e = (env.CORTEX_DEADLINE_EXIT_MENTOR_EFFORT ?? '').trim();
  const b = parseInt((env.CORTEX_DEADLINE_EXIT_MENTOR_BUDGET_TOKENS ?? '').trim(), 10);
  const t = parseInt((env.CORTEX_DEADLINE_EXIT_MENTOR_TIMEOUT_MS ?? '').trim(), 10);
  const f = parseFloat((env.CORTEX_DEADLINE_EXIT_MENTOR_RESIDUAL_FRAC ?? '').trim());
  return {
    enabled: (env.CORTEX_DEADLINE_EXIT_MENTOR ?? '').trim().toLowerCase() === 'true',
    effort: e || DEFAULTS.effort,
    outputBudgetTokensCap: Number.isInteger(b) && b > 0 ? b : DEFAULTS.outputBudgetTokensCap,
    timeoutMsCap: Number.isInteger(t) && t > 0 ? t : DEFAULTS.timeoutMsCap,
    residualFrac: Number.isFinite(f) && f > 0 && f < 1 ? f : DEFAULTS.residualFrac,
  };
}

/** Residual-scaled budget/timeout for ONE checkpoint call, never exceeding the caps and never
 *  eating more than residualFrac of the remaining wall-clock. */
export function deadlineExitCallBudget(cfg: DeadlineExitConfig, remainingMs: number): { timeoutMs: number; outputBudgetTokens: number } {
  const scaledTimeout = Math.max(0, Math.floor(remainingMs * cfg.residualFrac));
  const timeoutMs = Math.max(1, Math.min(cfg.timeoutMsCap, scaledTimeout || cfg.timeoutMsCap));
  // Keep the output budget proportional to the (bounded) time we allow — ~40 tok/s of headroom,
  // capped. A checkpoint verdict + one action line is short by design.
  const byTime = Math.floor((timeoutMs / 1000) * 40);
  const outputBudgetTokens = Math.max(256, Math.min(cfg.outputBudgetTokensCap, byTime || cfg.outputBudgetTokensCap));
  return { timeoutMs, outputBudgetTokens };
}

export const DEADLINE_EXIT_SYSTEM =
  'You are a senior engineer running a CHECKPOINT on a junior agent that is deep into a task in a ' +
  'real terminal container and is running low on time. You are given the TASK, an ENVIRONMENT REPORT, ' +
  'the WORK SO FAR, and the REMAINING BUDGET. Decide, in ONE verdict, what to do with the time left — ' +
  'the goal is to convert the residual into a PASS, or to stop wasting it on a lost cause.\n' +
  'FORMAT — your FIRST line MUST be exactly one of:\n' +
  '  VERDICT: CONTINUE   (on-track / closing in — let it keep working to the hard deadline; do NOT cut a near-win)\n' +
  '  VERDICT: FINISH     (the work ALREADY meets the task\'s real criteria — end now)\n' +
  '  VERDICT: ACTION     (a small specific gap remains and ONE action closes it within the residual)\n' +
  '  VERDICT: RETIRE     (stuck / structurally unclosable in the residual — end cleanly, stop grinding)\n' +
  'Judge against the TASK\'s real criteria (what the hidden grader checks), NOT the junior\'s own tests. ' +
  'Be decisive but fair: CONTINUE when there is genuine convergence (each recent step reduced the gap); ' +
  'RETIRE only when the same gap persists across attempts or a required capability is missing.\n' +
  'If ACTION: after the verdict line, give the SINGLE concrete step + the exact check to run.\n' +
  'If FINISH: optionally one clause confirming the criteria are met.\n' +
  'If RETIRE: one short line naming why the residual cannot close it.\n' +
  'If CONTINUE: nothing more.';

export interface DeadlineExitContext {
  task: string;
  envReport?: string;
  /** The work product so far: latest answer + recent tool outputs. */
  workProduct: string;
  /** A short human description of the time left, e.g. "~90s of a 900s budget (10%)". */
  remainingBudget: string;
  /** A brief trace of the last few tool calls / whether recent steps reduced the gap (for the
   *  convergence judgment), if available. */
  recentProgress?: string;
}

export function buildDeadlineExitPrompt(ctx: DeadlineExitContext): string {
  const parts: string[] = [];
  parts.push(`TASK:\n${(ctx.task || '').trim().slice(0, 2500)}`);
  const env = (ctx.envReport || '').trim();
  if (env) parts.push(`ENVIRONMENT REPORT:\n${env.slice(0, 2000)}`);
  parts.push(`REMAINING BUDGET: ${(ctx.remainingBudget || '').trim().slice(0, 200)}`);
  const prog = (ctx.recentProgress || '').trim();
  if (prog) parts.push(`RECENT PROGRESS (did each step reduce the gap?):\n${prog.slice(0, 1500)}`);
  parts.push(`WORK SO FAR (latest answer + recent tool outputs):\n${(ctx.workProduct || '').trim().slice(0, 5000)}`);
  parts.push(
    'Checkpoint now. First line: `VERDICT: CONTINUE` | `FINISH` | `ACTION` | `RETIRE`. ' +
      'If ACTION, the single step + its check; if RETIRE, one line why; if FINISH, one confirming clause.',
  );
  return parts.join('\n\n');
}

export type DeadlineExitDecision = 'continue' | 'finish' | 'action' | 'retire';

export interface DeadlineExitVerdict {
  decision: DeadlineExitDecision;
  /** ACTION: the step. RETIRE: the reason. FINISH: the confirming clause. */
  detail: string;
  /** Whether a verdict line was found (else fail-safe to CONTINUE — never cut a turn on a broken call). */
  parsed: boolean;
}

/** Parse the checkpoint response. Fail-SAFE to CONTINUE (let it keep working) when unparseable —
 *  a broken mentor call must never truncate a turn. */
export function parseDeadlineExitVerdict(text: string): DeadlineExitVerdict {
  const t = (text || '').trim();
  if (!t) return { decision: 'continue', detail: '', parsed: false };
  const m = t.match(/VERDICT:\s*(CONTINUE|FINISH|ACTION|RETIRE)/i);
  if (!m) return { decision: 'continue', detail: '', parsed: false };
  const decision = m[1]!.toLowerCase() as DeadlineExitDecision;
  const idx = t.indexOf(m[0]);
  const detail = t.slice(idx + m[0].length).trim();
  return { decision, detail, parsed: true };
}
