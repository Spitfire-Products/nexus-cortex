/**
 * inactionGuard — the loop ladder's INVERSE (docs/HARNESS_IMPROVEMENT_BACKLOG.md
 * item 2). TB2 2×2 evidence: persist-frame arms produced never-acted /
 * over-deliberated failures (5 pro-persist, 2 each flash arm, 0 pro-lifted) —
 * the model reasons to the output wall with ZERO tool calls, so every
 * existing guard (which all count tool calls) is blind to it.
 *
 * Mechanism: extends the R18b/R32 empty-response-retry precedent to
 * ACTLESS-VERBOSE responses — one injected "act first" steering retry,
 * bounded, fallback-accept. Default OFF (`CORTEX_INACTION_NUDGE=true` arms
 * it; bench/server profiles arm, interactive CLI stays off until specificity
 * is proven broadly).
 */

export interface InactionCheckInput {
  /** Total visible text+thinking characters of the final assistant response. */
  responseChars: number;
  /** Tool_use blocks in THIS assistant response (0 at the natural exit). */
  toolUseBlocksThisResponse: number;
  /** Tool calls executed across the ENTIRE turn so far. */
  executedToolCallsThisTurn: number;
  /** Tools offered on the request (0 = pure-chat, guard never fires). */
  toolsOffered: number;
  /** Orchestrator turn counter (0 = first turn of the session). v1 gate:
   *  only the first turn — later turns of a conversation are much more
   *  likely to be legitimately analytic follow-ups. */
  turnNumber: number;
  /** Single-nudge bound (mirrors emptyResponseRetryUsed). */
  alreadyNudged: boolean;
}

/** Resolve arming + threshold from env. Default OFF; threshold default 4000
 *  chars (the TB2 never-acted signature was multi-thousand-char reasoning
 *  dumps — short direct answers must never trigger). */
export function resolveInactionConfig(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  minChars: number;
} {
  const enabled = (env.CORTEX_INACTION_NUDGE ?? '').trim().toLowerCase() === 'true';
  const raw = env.CORTEX_INACTION_MIN_CHARS?.trim();
  const minChars = raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : 4000;
  return { enabled, minChars };
}

/** Should the inaction nudge fire? Pure — all state passed in. */
export function shouldNudgeInaction(
  input: InactionCheckInput,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cfg = resolveInactionConfig(env);
  if (!cfg.enabled) return false;
  if (input.alreadyNudged) return false;
  if (input.toolsOffered === 0) return false; // pure-chat request
  if (input.turnNumber !== 0) return false; // conservative v1: first turn only
  if (input.toolUseBlocksThisResponse > 0) return false;
  if (input.executedToolCallsThisTurn > 0) return false; // it acted earlier this turn
  return input.responseChars >= cfg.minChars;
}

/** The injected steering text (system-reminder-wrapped by the caller's
 *  standard synthetic-user-message shape). */
export function formatInactionNudge(): string {
  return (
    'You produced a long analysis but ran no commands. Act first: run at least ' +
    'one tool call to ground or execute your plan (inspect the actual files/state, ' +
    'or make the first concrete change), then answer. Do not restate the plan.'
  );
}
