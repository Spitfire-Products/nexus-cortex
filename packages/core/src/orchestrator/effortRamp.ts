/**
 * HB-EFFORT-RAMP (CORTEX_EFFORT_RAMP, DARK — 2026-09-30).
 *
 * Evidence (TB4.0 t4cw traces, photonic-waveguide-routing r2 / protein-autointerp-disulfide r1): the action model hit the
 * 65,536-token output wall right after reading the task — trying to solve the routing plan / the hidden rule in its head
 * before writing any code — and only began acting after being forced down to low. The lift planner has already written the
 * plan of attack at that point. This lever runs the first N action calls of a turn at a lower effort, then hands back to
 * the configured effort (CORTEX_ACTION_EFFORT / request param / card). NOTE: a GLOBAL low was measured harmful on TB4.0
 * (e6: 3/29 vs high 10/29) — this lever only covers the opening calls.
 *
 *   CORTEX_EFFORT_RAMP = off (default) | <level>[:<calls>] (e.g. low:8; calls 1..100, default 8) | on (= low:8)
 *
 * Precedence at a call: R153 exhaustion backoff > effort pulse > ramp > request param > card.
 */
import type { ReasoningEffortLevel } from './emptyResponseClassifier.js';

export interface EffortRampConfig { enabled: boolean; level: ReasoningEffortLevel; calls: number }

const LEVELS: readonly ReasoningEffortLevel[] = ['low', 'medium', 'high', 'max'];
const OFF: EffortRampConfig = { enabled: false, level: 'low', calls: 0 };

export function resolveEffortRamp(env: NodeJS.ProcessEnv = process.env): EffortRampConfig {
  const v = String(env.CORTEX_EFFORT_RAMP ?? '').trim().toLowerCase();
  if (v === '' || v === 'off' || v === 'false' || v === '0') return OFF;
  if (v === 'on' || v === 'true' || v === '1') return { enabled: true, level: 'low', calls: 8 };
  const [lv, n] = v.split(':');
  if (!LEVELS.includes(lv as ReasoningEffortLevel)) return OFF;
  const calls = n === undefined || n === '' ? 8 : Number(n);
  if (!Number.isFinite(calls) || calls < 1) return OFF;
  return { enabled: true, level: lv as ReasoningEffortLevel, calls: Math.min(100, Math.floor(calls)) };
}

/** The ramp level for the call with this index in the turn (0 = the initial request), or undefined once the ramp is over. */
export function rampEffortFor(cfg: EffortRampConfig, callIndex: number): ReasoningEffortLevel | undefined {
  return cfg.enabled && callIndex < cfg.calls ? cfg.level : undefined;
}
