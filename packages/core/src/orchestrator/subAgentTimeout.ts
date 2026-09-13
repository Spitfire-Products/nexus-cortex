/**
 * subAgentTimeout — R133 HB-SUBAGENT-TIMEOUT (2026-09-13).
 *
 * Both Task dispatch sites in CortexOrchestrator spawned the child with a HARDCODED `timeoutMs: 300000`
 * regardless of the parent's own wall-clock budget: in an 8-hour-budget bench task 3 of 6 Task dispatches
 * ended `Status: TIMEOUT Duration: 300.0s` (one after 62 turns / 6 files modified). The child also
 * inherited CORTEX_TURN_DEADLINE_MS verbatim from process.env, so its OWN turn deadline was the parent's
 * FULL budget while its process was killed at 5 minutes.
 *
 * This pure resolver derives the sub-agent timeout at dispatch time:
 *   1. `requestedMs` (the Task input `timeout_ms`) wins, clamped to [MIN, remaining - margin] when a
 *      parent deadline exists (otherwise only floored);
 *   2. else a live parent deadline → 90% of the remaining turn budget minus a 30 s margin (floored at MIN,
 *      capped by CORTEX_SUBAGENT_TIMEOUT_MAX_MS when set);
 *   3. else CORTEX_SUBAGENT_TIMEOUT_MS when a positive number;
 *   4. else the historical 5-minute default.
 *
 * The SubAgent* library defaults keep DEFAULT_SUBAGENT_TIMEOUT_MS unchanged — the derivation happens at
 * dispatch only.
 */
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 300_000;
export const MIN_SUBAGENT_TIMEOUT_MS = 60_000;
/** Margin kept between the child's limit and the parent's remaining budget so the parent can still report. */
export const SUBAGENT_DEADLINE_MARGIN_MS = 30_000;
/** Fraction of the parent's remaining turn budget a child may consume. */
export const SUBAGENT_DEADLINE_FRACTION = 0.9;

export type SubAgentTimeoutSource = 'requested' | 'deadline' | 'env' | 'default';

export interface ResolveSubAgentTimeoutInput {
  /** The Task input `timeout_ms` (already coerced to a number by the caller; NaN/undefined = not requested). */
  requestedMs?: number;
  /** The parent's remaining turn budget in ms (0 or undefined = no deadline). */
  remainingMs?: number;
  env?: NodeJS.ProcessEnv;
}

function positiveEnvNumber(env: NodeJS.ProcessEnv, key: string): number {
  const n = Number(String(env[key] ?? '').trim() || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function resolveSubAgentTimeoutMs(
  input: ResolveSubAgentTimeoutInput = {},
): { timeoutMs: number; source: SubAgentTimeoutSource } {
  const env = input.env ?? process.env;
  const remaining = Number.isFinite(input.remainingMs) && (input.remainingMs as number) > 0 ? (input.remainingMs as number) : 0;
  const requested = Number.isFinite(input.requestedMs) && (input.requestedMs as number) > 0 ? (input.requestedMs as number) : 0;

  if (requested > 0) {
    let ms = Math.max(MIN_SUBAGENT_TIMEOUT_MS, Math.floor(requested));
    if (remaining > 0) ms = Math.max(MIN_SUBAGENT_TIMEOUT_MS, Math.min(ms, remaining - SUBAGENT_DEADLINE_MARGIN_MS));
    return { timeoutMs: ms, source: 'requested' };
  }

  if (remaining > 0) {
    let ms = Math.max(MIN_SUBAGENT_TIMEOUT_MS, Math.floor(remaining * SUBAGENT_DEADLINE_FRACTION) - SUBAGENT_DEADLINE_MARGIN_MS);
    const cap = positiveEnvNumber(env, 'CORTEX_SUBAGENT_TIMEOUT_MAX_MS');
    if (cap > 0) ms = Math.min(ms, cap);
    return { timeoutMs: ms, source: 'deadline' };
  }

  const fromEnv = positiveEnvNumber(env, 'CORTEX_SUBAGENT_TIMEOUT_MS');
  if (fromEnv > 0) return { timeoutMs: Math.floor(fromEnv), source: 'env' };

  return { timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS, source: 'default' };
}
