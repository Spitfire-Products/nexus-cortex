/**
 * thrashDetector — shape-agnostic STRUGGLE signal (MENTORSHIP_ASK_FOR_ADVICE_SPEC §2).
 *
 * The dominant bench failure mode is DIVERSE-exploration thrash: the model makes many
 * DIFFERENT failing attempts (44–105 calls on hard tasks) that the loop/approach
 * detectors miss because it is not a clean repeated loop. This fires on failure
 * DENSITY over a recent window — regardless of shape — once past a turn floor (a few
 * failing probes early are normal debugging; cf. MAX_CONSECUTIVE_ERRORS=6). Pure +
 * env-configurable; the orchestrator feeds it the recent tool outcomes it already
 * tracks (the decision-store success/fail signal). Sterile-bench-safe (hot tier, no key).
 */

export interface ThrashConfig {
  /** Failures within the window that trip thrash. Default 4. */
  failThreshold: number;
  /** Size of the recent tool-outcome window examined. Default 6. */
  window: number;
  /** Do not fire before this many tool calls total (early failures are normal). Default 5. */
  minTurns: number;
}

export interface ThrashState {
  /** True when the model is thrashing and the mentor path should engage. */
  thrashing: boolean;
  /** Failures counted in the examined window. */
  failures: number;
  /** Outcomes actually examined (== min(window, available)). */
  examined: number;
}

export const THRASH_DEFAULTS: ThrashConfig = { failThreshold: 4, window: 6, minTurns: 5 };

function posInt(v: string | undefined, d: number): number {
  const n = parseInt((v ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : d;
}

export function resolveThrashConfig(env: NodeJS.ProcessEnv = process.env): ThrashConfig {
  return {
    failThreshold: posInt(env.CORTEX_THRASH_FAILS, THRASH_DEFAULTS.failThreshold),
    window: posInt(env.CORTEX_THRASH_WINDOW, THRASH_DEFAULTS.window),
    minTurns: posInt(env.CORTEX_THRASH_MIN_TURNS, THRASH_DEFAULTS.minTurns),
  };
}

/**
 * Decide whether the agent is thrashing.
 *
 * @param outcomes   success booleans of tool calls, chronological (oldest→newest).
 * @param turnCount  total tool calls so far (>= outcomes.length).
 * @param cfg        thresholds (defaults from env).
 *
 * Fires only when: past the turn floor, a FULL window is available, the failure
 * count meets the threshold, AND the most-recent outcome is a failure (so it never
 * fires right after the model just made progress).
 */
export function resolveThrashState(
  outcomes: boolean[],
  turnCount: number,
  cfg: ThrashConfig = resolveThrashConfig(),
): ThrashState {
  const win = outcomes.slice(-cfg.window);
  const failures = win.reduce((n, ok) => n + (ok ? 0 : 1), 0);
  const currentlyFailing = win.length > 0 && win[win.length - 1] === false;
  const thrashing =
    turnCount >= cfg.minTurns &&
    win.length >= cfg.window &&
    failures >= cfg.failThreshold &&
    currentlyFailing;
  return { thrashing, failures, examined: win.length };
}
