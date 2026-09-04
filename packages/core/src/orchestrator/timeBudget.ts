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
