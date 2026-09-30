/**
 * HB-COMPUTE-NUDGE (CORTEX_COMPUTE_NUDGE, DARK — 2026-09-30).
 *
 * Evidence (TB4.0 t4cw traces): besides the 65,536-token walls, steps that DID act often carried 35K-52K reasoning tokens first
 * — the model working a geometry/rule question through in its head instead of testing it. photonic r2's good stretch began the
 * moment it ran the task's checker. After a round whose response reasoned past a threshold, this lever appends one line to the
 * TAIL of the newest tool_result (same cache-safe carrier as HB-TURN-STATUS) telling it to compute/test instead of deliberating.
 *
 *   CORTEX_COMPUTE_NUDGE = off (default; byte-identical) | on
 *   CORTEX_COMPUTE_NUDGE_TOKENS   reasoning tokens that trigger it (default 16000)
 *   CORTEX_COMPUTE_NUDGE_COOLDOWN rounds between nudges (default 3)
 *   CORTEX_COMPUTE_NUDGE_MAX      nudges per turn (default 6)
 */

export interface ComputeNudgeConfig { enabled: boolean; thresholdTokens: number; cooldownRounds: number; maxPerTurn: number }

function num(v: string | undefined, dflt: number, min: number, max: number): number {
  const n = Number(String(v ?? '').trim());
  return String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= min ? Math.min(max, Math.floor(n)) : dflt;
}

export function resolveComputeNudge(env: NodeJS.ProcessEnv = process.env): ComputeNudgeConfig {
  const v = String(env.CORTEX_COMPUTE_NUDGE ?? '').trim().toLowerCase();
  const enabled = v === 'on' || v === 'true' || v === '1';
  return {
    enabled,
    thresholdTokens: num(env.CORTEX_COMPUTE_NUDGE_TOKENS, 16000, 1000, 1_000_000),
    cooldownRounds: num(env.CORTEX_COMPUTE_NUDGE_COOLDOWN, 3, 0, 1000),
    maxPerTurn: num(env.CORTEX_COMPUTE_NUDGE_MAX, 6, 1, 1000),
  };
}

export interface ComputeNudgeState { reasoningTokens: number; round: number; lastFiredRound: number; firedThisTurn: number }

export function computeNudgeDecision(cfg: ComputeNudgeConfig, st: ComputeNudgeState): boolean {
  if (!cfg.enabled) return false;
  if (!(st.reasoningTokens >= cfg.thresholdTokens)) return false;
  if (st.firedThisTurn >= cfg.maxPerTurn) return false;
  return st.round - st.lastFiredRound >= Math.max(1, cfg.cooldownRounds);
}

export function buildComputeNudgeLine(reasoningTokens: number): string {
  const k = Math.round(reasoningTokens / 1000);
  return '<system-reminder>COMPUTE, DON\'T DELIBERATE: your last step spent ~' + k + 'K reasoning tokens before acting. When a ' +
    'question can be computed or tested (geometry, a rule, counts, a formula, an edge case), write and run a short script or the ' +
    'task\'s own checker now instead of working it out in your head, and reason only about what the result shows.</system-reminder>';
}

/** Reasoning tokens of the newest assistant message in history (usage.reasoningTokens, else its output tokens); 0 when none. */
export function lastAssistantReasoningTokens(history: readonly any[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const role = m?.message?.role ?? m?.role;
    if (role !== 'assistant') continue;
    const u = m?.usage ?? m?.message?.usage ?? {};
    const r = Number(u.reasoningTokens ?? u.reasoning_tokens ?? 0);
    if (r > 0) return r;
    const o = Number(u.outputTokens ?? u.output_tokens ?? 0);
    return o > 0 ? o : 0;
  }
  return 0;
}
