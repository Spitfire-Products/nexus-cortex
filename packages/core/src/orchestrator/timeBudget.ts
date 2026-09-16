/**
 * timeBudget — #2 wall-clock break (verified 2026-09-04: the orchestrator's tool loop had NO time
 * budget, only count-based caps — CortexOrchestrator.ts:1780/4089 while-conditions are purely
 * `toolCallIteration < MAX_TOOL_ITERATIONS`). A model making novel-but-non-converging tool calls
 * (no exact loop, no errors, under the iteration cap) runs to MAX_TOOL_ITERATIONS=1000, re-sending a
 * growing context every turn → the loop-killed grinders that burned ~24.8M input tokens each and drove
 * the run's real cost (the DeepSeek dashboard proved the token volume, not the banked ~1/5). Harbor's
 * per-task `[agent] timeout_sec` is an EXTERNAL cap the orchestrator never received.
 *
 * OPT-IN: deadlineMs <= 0 ⇒ 'ok' always (no behaviour change when unset). Set via
 * CORTEX_TURN_DEADLINE_MS or loopControl.turnDeadlineMs; the bench adapter passes ~90% of the task's
 * own budget so the harness converges BEFORE the external timeout kills it with zero deliverable.
 */
export type TimeBudgetState = 'ok' | 'warn' | 'break';

export function resolveTurnDeadlineMs(
  configured: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (Number.isFinite(configured) && (configured as number) > 0) return configured as number;
  const e = Number(env.CORTEX_TURN_DEADLINE_MS);
  return Number.isFinite(e) && e > 0 ? e : 0;
}

export function timeBudgetState(
  elapsedMs: number,
  deadlineMs: number,
  warnFrac = 0.9,
): TimeBudgetState {
  if (!(deadlineMs > 0)) return 'ok';
  if (elapsedMs >= deadlineMs) return 'break';
  if (elapsedMs >= deadlineMs * warnFrac) return 'warn';
  return 'ok';
}

/** One-shot nudge injected once when the turn crosses warnFrac of its deadline. */
export function timeBudgetWarnNudge(elapsedMs: number, deadlineMs: number): string {
  const remainingS = Math.max(0, Math.round((deadlineMs - elapsedMs) / 1000));
  return (
    `<system-reminder>TIME BUDGET: you have ~${remainingS}s left before this task's wall-clock limit. ` +
    `Stop exploring and CONVERGE now — write your best current result to the required artifact and call ` +
    `EndTurn. If you cannot finish, submit the closest working version rather than nothing (partial credit ` +
    `beats a timeout with zero output).</system-reminder>`
  );
}

/**
 * R151 HB-BUDGET-VISIBILITY (2026-09-15, tb4-flash-v2 curation): the model was never told its wall budget. On 8-hour tasks
 * 45 of 49 fails ended in under 2 h (median 43 min) and 43 of them with self-declared open items ("did not get to execute it
 * within budget" at 2 h of 8). The only time signal was the 90% WARN rung, which no failing session reached. Two levers:
 *   CORTEX_BUDGET_VISIBILITY (default ON when a turn deadline exists): a one-line WALL BUDGET reminder appended to the tool
 *     result each time elapsed crosses a 10% band (at most ~10 per turn; silent when no deadline is configured).
 *   CORTEX_BUDGET_CONTINUE_MIN_REMAINING (default 0.5; 0 = off): at a finish whose draft lists open/unverified items while at
 *     least this fraction of the budget remains, one continue-with-budget nudge per turn (rides the surrender-guard plumbing).
 */
export function resolveBudgetVisibility(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.CORTEX_BUDGET_VISIBILITY ?? '').trim().toLowerCase();
  if (v === '') return true;
  return v === 'true' || v === '1' || v === 'on';
}

export function resolveBudgetContinueMinRemaining(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.CORTEX_BUDGET_CONTINUE_MIN_REMAINING ?? '').trim();
  if (raw === '') return 0.5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1, n);
}

/** R157: how many continue-with-budget nudges a single turn may receive (CORTEX_BUDGET_CONTINUE_MAX_NUDGES; default 2; 0 = off; max 10). */
export function resolveBudgetContinueMaxNudges(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.CORTEX_BUDGET_CONTINUE_MAX_NUDGES ?? '').trim();
  if (raw === '') return 2;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(10, Math.floor(n));
}

/** 0..bands index of the elapsed fraction; -1 when no deadline. Band changes are the injection points. */
export function budgetBand(elapsedMs: number, deadlineMs: number, bands = 10): number {
  if (!(deadlineMs > 0)) return -1;
  return Math.max(0, Math.min(bands, Math.floor((elapsedMs / deadlineMs) * bands)));
}

export function formatBudgetHM(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60); const m = total % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** The per-band WALL BUDGET line (no CONVERGE language until the warn rung — that is timeBudgetWarnNudge's job). */
export function budgetVisibilityLine(elapsedMs: number, deadlineMs: number): string {
  const pct = Math.min(100, Math.max(0, Math.round((elapsedMs / deadlineMs) * 100)));
  const remaining = Math.max(0, deadlineMs - elapsedMs);
  return (
    `<system-reminder>WALL BUDGET: ${formatBudgetHM(deadlineMs)} total; elapsed ${formatBudgetHM(elapsedMs)} (${pct}%); ` +
    `~${formatBudgetHM(remaining)} remaining. Use it: run the task's own checks, close every open item, iterate on anything ` +
    `unverified — finishing with unfinished or unverified items while budget remains forfeits the result.</system-reminder>`
  );
}
