/**
 * AutoResearchConfirm — what to do with a winner after the gate, and how many runs the
 * gate needs to see the gains we care about.
 *
 * CONFIRMATION (decideConfirmation). Picking the best of N noisy arms inflates its
 * measured effect (the winner's curse); the FWER bar controls false keeps but not that
 * bias. So the loop re-benches the selected winner on FRESH runs. How that fresh run is
 * judged matters, because model variance is large:
 *
 *   - 'strict'    — the fresh run must pass the full gate again. Requiring significance
 *                   twice costs real power (a z-approximation of a 3-arm round: a gain the
 *                   gate finds 77% of the time merges 69%; a small gain 49% → 35%).
 *   - 'direction' — the fresh effect must be > 0 and its CI must clear a loss margin. No
 *                   power loss, but it only halves lucky-winner merges (0.050 → 0.028).
 *   - 'pooled'    — DEFAULT. Stouffer-combine the screening and confirmation p-values
 *                   (an inverse-normal two-stage combination test) and require the
 *                   combined z to clear the same bar the gate used, AND the fresh effect
 *                   to be > 0. Keeps almost all the power (77% → 77%, 49% → 47%) and cuts
 *                   lucky-winner merges 0.050 → 0.019.
 *
 *   (Numbers: 200k simulated rounds, 3 arms, alpha 0.05 Šidák-adjusted, confirmation with
 *   the same runs as screening; scratch sim recorded in the commit message.)
 *
 * CONSISTENCY ('pooled' and 'direction'). Pooling lets an extreme screening result carry
 * a fresh run whose effect has all but vanished (end-to-end: screening +39 at p 0.0005,
 * fresh +0.75 at p 0.056 → pooled z 3.45 passed). That is not noise near the bar but a
 * candidate that behaved differently between the stages (state, time, flakiness). So the
 * fresh effect must also be CONSISTENT with the screening one: not significantly smaller,
 * z_diff = (e1 - e2) / sqrt(se1² + se2²) <= consistencyZ (default 2.576, p 0.005 —
 * strict, so ordinary regression to the mean passes). Simulated cost: <= 0.008 power, no
 * change in false merges.
 *
 * RUN PLANNING (planRuns). The gate's evidence scales with runs per arm. From the
 * observed per-task score SDs it reports the smallest effect the configured runs can
 * detect (at the gate's own bar and the requested power) and the runs per arm needed to
 * detect a target effect. A normal approximation to the bootstrap/permutation gate —
 * planning guidance, not a decision rule.
 */
import type { ExperimentVerdict } from './AutoResearchStats.js';

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Standard normal quantile (Acklam's rational approximation, rel. error < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/** The z the gate effectively requires: its CI must exclude 0 (two-sided `ci` mass) AND
 *  p <= alphaAdjusted (one-sided). */
export function gateZ(alphaAdjusted = 0.05, ci = 0.95): number {
  return Math.max(normalQuantile(1 - (1 - ci) / 2), normalQuantile(1 - alphaAdjusted));
}

export type ConfirmMode = 'pooled' | 'direction' | 'strict';

export interface ConfirmOptions {
  /** default 'pooled' */
  mode?: ConfirmMode;
  /** 'direction' mode: the fresh CI's lower bound must exceed -lossMargin (score points
   *  on the 0-100 scale). Default 2.5. */
  lossMargin?: number;
  /** CI mass the gate used (default 0.95). */
  ci?: number;
  /** consistency bar: max z of (screening effect − fresh effect) (default 2.576). */
  consistencyZ?: number;
}

export interface ConfirmDecision {
  confirmed: boolean;
  mode: ConfirmMode;
  /** 'pooled': the Stouffer-combined one-sided p-value of screening + confirmation. */
  combinedP?: number;
  /** z of (screening effect − fresh effect); large = the fresh run fell short of screening. */
  shortfallZ?: number;
  reason: string;
}

/** Judge a winner's confirmation run against its screening verdict. */
export function decideConfirmation(screen: ExperimentVerdict, confirm: ExperimentVerdict, opts: ConfirmOptions = {}): ConfirmDecision {
  const mode = opts.mode ?? 'pooled';
  if (confirm.decision === 'pending') {
    return { confirmed: false, mode, reason: `confirmation had insufficient data (${confirm.reason})` };
  }
  if (mode === 'strict') {
    const ok = confirm.decision === 'keep';
    return { confirmed: ok, mode, reason: `strict: confirmation ${confirm.decision} (${confirm.reason})` };
  }
  const upward = confirm.effect > 0;
  // Stage consistency: the fresh effect must not be significantly below the screening one.
  const zCi = normalQuantile(1 - (1 - (opts.ci ?? 0.95)) / 2);
  const seOf = (v: ExperimentVerdict) => (v.ciLow != null && v.ciHigh != null ? (v.ciHigh - v.ciLow) / (2 * zCi) : undefined);
  const se1 = seOf(screen); const se2 = seOf(confirm);
  const shortfallZ = se1 != null && se2 != null && se1 + se2 > 0
    ? round4((screen.effect - confirm.effect) / Math.sqrt(se1 * se1 + se2 * se2))
    : undefined;
  const consistencyBar = opts.consistencyZ ?? 2.5758;
  const consistent = shortfallZ == null || shortfallZ <= consistencyBar;
  const inconsistency = `fresh effect ${confirm.effect} is far below screening ${screen.effect} (shortfall z ${shortfallZ} > ${round4(consistencyBar)}) — the candidate behaved differently between the stages`;
  if (mode === 'direction') {
    const margin = opts.lossMargin ?? 2.5;
    const ciLow = confirm.ciLow ?? -Infinity;
    const ok = upward && ciLow > -margin && consistent;
    return {
      confirmed: ok, mode, ...(shortfallZ != null ? { shortfallZ } : {}),
      reason: ok
        ? `direction: fresh effect +${confirm.effect}, CI low ${ciLow} > -${margin}`
        : `direction: ${!upward ? `fresh effect ${confirm.effect} <= 0` : !consistent ? inconsistency : `CI low ${ciLow} <= -${margin} (possible loss)`}`,
    };
  }
  // pooled — inverse-normal combination of the two stages, at the gate's own bar.
  if (screen.pValue == null || confirm.pValue == null) {
    return { confirmed: false, mode, reason: 'pooled: a stage has no p-value' };
  }
  const z1 = normalQuantile(1 - screen.pValue);
  const z2 = normalQuantile(1 - confirm.pValue);
  const z = (z1 + z2) / Math.SQRT2;
  const bar = gateZ(screen.alphaAdjusted ?? 0.05, opts.ci ?? 0.95);
  const combinedP = round4(1 - normalCdf(z));
  const ok = upward && z > bar && consistent;
  return {
    confirmed: ok, mode, combinedP, ...(shortfallZ != null ? { shortfallZ } : {}),
    reason: ok
      ? `pooled: fresh effect +${confirm.effect}; combined p=${combinedP} (z ${round4(z)} > ${round4(bar)})`
      : `pooled: ${!upward ? `fresh effect ${confirm.effect} <= 0` : !consistent ? inconsistency : `combined p=${combinedP} (z ${round4(z)} <= ${round4(bar)})`}`,
  };
}

export interface RunPlanTask {
  /** sample SD of the base arm's per-run scores for this task */
  baseSd: number;
  /** sample SD of the candidate arm's per-run scores for this task */
  candSd: number;
}

export interface RunPlanOptions {
  /** runs per arm per task actually configured */
  runsPerArm: number;
  /** the family-adjusted one-sided alpha the gate tests against (default 0.05) */
  alphaAdjusted?: number;
  /** desired probability of detecting `targetEffect` (default 0.8) */
  power?: number;
  /** the aggregate effect worth detecting, in score points (default 5) */
  targetEffect?: number;
  /** CI mass the gate used (default 0.95) */
  ci?: number;
}

export interface RunPlan {
  runsPerArm: number;
  targetEffect: number;
  power: number;
  /** standard error of the aggregate effect at the configured runs */
  seEffect: number;
  /** smallest aggregate effect detectable with `power` at the configured runs */
  detectableEffect: number;
  /** runs per arm per task needed to detect `targetEffect` with `power` (>= 2) */
  requiredRunsPerArm: number;
  /** requiredRunsPerArm <= runsPerArm */
  adequate: boolean;
}

/** Runs-per-arm planning for the aggregate effect (mean over tasks of cand - base). */
export function planRuns(tasks: readonly RunPlanTask[], opts: RunPlanOptions): RunPlan {
  const n = Math.max(1, opts.runsPerArm);
  const power = opts.power ?? 0.8;
  const target = opts.targetEffect ?? 5;
  const T = Math.max(1, tasks.length);
  // Var(effect) = (1/T²) Σ_t (σ_b² + σ_c²) / n  →  V1 = Var at n = 1
  const v1 = tasks.reduce((s, t) => s + t.baseSd ** 2 + t.candSd ** 2, 0) / (T * T);
  const zSum = gateZ(opts.alphaAdjusted ?? 0.05, opts.ci ?? 0.95) + normalQuantile(power);
  const seEffect = Math.sqrt(v1 / n);
  const required = v1 === 0 ? 2 : Math.max(2, Math.ceil((zSum * zSum * v1) / (target * target)));
  return {
    runsPerArm: n,
    targetEffect: target,
    power,
    seEffect: round4(seEffect),
    detectableEffect: round4(zSum * seEffect),
    requiredRunsPerArm: required,
    adequate: required <= n,
  };
}

/** Sample standard deviation (n-1); 0 for fewer than two values. */
export function sampleSd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
