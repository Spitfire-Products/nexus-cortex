/**
 * HB-WALL-RETRY-LADDER (R241 / R240, 2026-10-06, DARK).
 *
 * Why: under the 393,216-token cap every reasoning wall in the 10-05 TB4 cell was a DEGENERATE REPETITION LOOP (40/40), and the retry
 * after a wall re-entered the same loop from its first tokens at full cap price (~$0.47 + ~20 min each). DeepSeek offers no server-side
 * cycle breaker in thinking mode (penalties deprecated, temperature inert, stop sequences do not reach reasoning_content — probed 10-06),
 * and the bench's action call is non-streaming, so the only bound is the retry's own max_tokens and its mode.
 *
 * What: after the n-th reasoning-exhaustion wall in a turn, the empty-response RETRY is sent with (a) max_tokens from a ladder
 * (CORTEX_WALL_RETRY_LADDER="65536,16384": wall 1 → 65,536, wall 2+ → 16,384; shorter ladders repeat the last rung) and, from wall
 * CORTEX_WALL_FORCE_ACTION_AT (default 2) on, (b) `tool_choice: required` — which on DeepSeek the gateway already turns into thinking OFF
 * (AC ~1011-1016 / 1056-1062): the model must emit a tool call and act. Probed 10-06: the forced thinking-off tool call works
 * mid-conversation and thinking resumes on the next call; the switch costs ONE uncached prefix read (thinking mode is in the cache key).
 * Only exhaustion kinds qualify — never a "do not call tools" nudge kind (nudgeForbidsTools). Off = byte-identical.
 */
import type { EmptyResponseClassification } from './emptyResponseClassifier.js';
import { isReasoningExhaustion, nudgeForbidsTools } from './emptyResponseClassifier.js';

export interface WallRetryLadderConfig {
  enabled: boolean;
  /** max_tokens per wall index (1-based); the last rung repeats. */
  rungs: number[];
  /** wall index (1-based) from which the retry forces an action (tool_choice required → thinking off on DeepSeek); 0 = never. */
  forceActionAt: number;
}

export function resolveWallRetryLadder(env: NodeJS.ProcessEnv = process.env): WallRetryLadderConfig {
  const raw = String(env.CORTEX_WALL_RETRY_LADDER ?? '').trim();
  const rungs = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 1024);
  const fa = parseInt(String(env.CORTEX_WALL_FORCE_ACTION_AT ?? '').trim(), 10);
  return {
    enabled: rungs.length > 0,
    rungs,
    forceActionAt: Number.isInteger(fa) && fa >= 0 ? fa : 2,
  };
}

/** max_tokens for the retry after wall number `wallIndex` (1-based); `baseCap` bounds it (never raise above the request's own cap). */
export function ladderCapFor(cfg: WallRetryLadderConfig, wallIndex: number, baseCap: number | undefined): number | undefined {
  if (!cfg.enabled || cfg.rungs.length === 0 || wallIndex < 1) return baseCap;
  const rung = cfg.rungs[Math.min(wallIndex, cfg.rungs.length) - 1]!;
  return baseCap && baseCap > 0 ? Math.min(baseCap, rung) : rung;
}

/** Force an action on this retry? Only for reasoning-exhaustion walls, never for nudge kinds that forbid tools. */
export function shouldForceAction(cfg: WallRetryLadderConfig, wallIndex: number, cls: EmptyResponseClassification | null | undefined): boolean {
  if (!cfg.enabled || cfg.forceActionAt <= 0 || wallIndex < cfg.forceActionAt) return false;
  if (!isReasoningExhaustion(cls)) return false;
  if (cls && nudgeForbidsTools(cls.kind)) return false;
  return true;
}
