/**
 * HB-EFFORT-RAMP (CORTEX_EFFORT_RAMP, DARK — 2026-09-30).
 *
 * Evidence (TB4.0 t4cw traces, photonic-waveguide-routing r2 / protein-autointerp-disulfide r1): the action model hit the
 * 65,536-token output wall right after reading the task — on its 3rd and 6th calls — trying to solve the routing plan / the
 * hidden rule in its head before writing any code, and only began acting after being forced down to low. A window of action
 * calls runs at a lower effort, then the configured effort (CORTEX_ACTION_EFFORT / request param / card) returns.
 * Calls are counted from 1 per turn (1 = the initial request). The initial call should stay at the configured effort: the
 * 4.124.35 smoke with the window starting at call 1 skipped the boot prompt's orient step in 2 of 3 runs (0 of 1 without).
 * NOTE: a GLOBAL low was measured harmful on TB4.0 (e6: 3/29 vs high 10/29) — this lever covers only the window.
 *
 *   CORTEX_EFFORT_RAMP = off (default) | <level>:<from>-<to> (e.g. low:2-8, calls from..to inclusive, 1..100)
 *                      | <level>:<n> (calls 2..n+1 — the initial call is never ramped) | on (= low:2-8)
 *
 * Precedence at a call: R153 exhaustion backoff > effort pulse > ramp > request param > card.
 */
import type { ReasoningEffortLevel } from './emptyResponseClassifier.js';

export interface EffortRampConfig { enabled: boolean; level: ReasoningEffortLevel; from: number; to: number }

const LEVELS: readonly ReasoningEffortLevel[] = ['low', 'medium', 'high', 'max'];
const OFF: EffortRampConfig = { enabled: false, level: 'low', from: 0, to: 0 };
const int = (x: string | undefined): number => (x !== undefined && /^\d+$/.test(x.trim()) ? Number(x.trim()) : NaN);

export function resolveEffortRamp(env: NodeJS.ProcessEnv = process.env): EffortRampConfig {
  const v = String(env.CORTEX_EFFORT_RAMP ?? '').trim().toLowerCase();
  if (v === '' || v === 'off' || v === 'false' || v === '0') return OFF;
  if (v === 'on' || v === 'true' || v === '1') return { enabled: true, level: 'low', from: 2, to: 8 };
  const [lv, spec] = v.split(':');
  if (!LEVELS.includes(lv as ReasoningEffortLevel) || spec === undefined) return OFF;
  let from: number; let to: number;
  if (spec.includes('-')) { const [a, b] = spec.split('-'); from = int(a); to = int(b); }
  else { const n = int(spec); from = 2; to = n + 1; }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 2 || to < from) return OFF; // the initial call is never ramped
  return { enabled: true, level: lv as ReasoningEffortLevel, from, to: Math.min(100, to) };
}

/** The ramp level for the call with this 0-based index in the turn (0 = the initial request = call 1), or undefined. */
export function rampEffortFor(cfg: EffortRampConfig, callIndex: number): ReasoningEffortLevel | undefined {
  const call = callIndex + 1;
  return cfg.enabled && call >= cfg.from && call <= cfg.to ? cfg.level : undefined;
}
