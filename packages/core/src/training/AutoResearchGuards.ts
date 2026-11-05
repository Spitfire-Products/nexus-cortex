/**
 * AutoResearchGuards — a gain on the aggregate must not hide a loss in one task family
 * (autoresearch hardening B4).
 *
 * The gate keeps a candidate on the AGGREGATE effect (mean over tasks). A change can
 * lift that mean while one family of tasks (TaskClassifier T1..T5 / GENERAL) gets worse,
 * and a loop that merges such changes round after round can drift a family down in
 * steps too small to notice one at a time. Two guards, both per family:
 *
 *   STEP  — this candidate vs its base: the family's effect.
 *   TOTAL — the running sum of the family's effect over every merged round plus this
 *           one, i.e. the drift from the round-0 base, built from each step's own
 *           (interleaved) measurement, so no extra runs and no cross-time comparison.
 *
 * Rule (both guards): a family BLOCKS when its loss is MATERIAL (estimate < -margin) AND
 * EVIDENT (its one-sided upper confidence bound is < 0, at alpha split across the
 * families). Model variance is large: a point-estimate rule alone (est < -2 with an SE
 * of ~5) would block ~34% of no-change families, and a non-inferiority rule (CI low >
 * -margin) would block most of them. Requiring evidence keeps false blocks <= alpha per
 * round, at the price of missing small real losses when runs are few — the run planner
 * (planRuns) says how many runs the gate needs.
 *
 * SEs are analytic (sample variances, Welch–Satterthwaite df, t quantiles), not
 * bootstrapped: with 3-4 runs per arm a percentile bootstrap understates the spread and
 * normal quantiles are too tight — that combination blocked ~9% of no-change rounds in
 * the test instead of <= 5%.
 */
import type { RNG, TaskArms } from './AutoResearchStats.js';
import { normalQuantile } from './AutoResearchConfirm.js';

export interface FamilyEffect {
  family: string;
  nTasks: number;
  /** mean over the family's tasks of (candMean - baseMean), score points */
  effect: number;
  /** standard error of `effect` (sample variances of the per-run scores) */
  se: number;
  /** Welch–Satterthwaite degrees of freedom of `se` */
  df: number;
  /** one-sided upper confidence bound at the family-split alpha */
  upper: number;
}

export interface GuardVerdict {
  family: string;
  /** 'step' = this candidate vs its base; 'total' = running drift from the round-0 base */
  scope: 'step' | 'total';
  effect: number;
  se: number;
  upper: number;
  margin: number;
  blocked: boolean;
}

export interface GuardOptions {
  /** per-step loss margin, score points (default 2) */
  margin?: number;
  /** running-total loss margin, score points (default 5) */
  totalMargin?: number;
  /** guard error rate per round, split across families (default 0.05) */
  alpha?: number;
  /** unused (kept for call-site compatibility with the gate options) */
  iterations?: number;
  seed?: number;
  rng?: RNG;
  /** minimum runs per arm for a task to count (default 2) */
  minRunsPerArm?: number;
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/** Student-t quantile via the Cornish–Fisher expansion (df >= 1; exact enough for bounds). */
export function tQuantile(p: number, df: number): number {
  const z = normalQuantile(p);
  if (!Number.isFinite(df) || df > 1e6) return z;
  const z3 = z ** 3, z5 = z ** 5, z7 = z ** 7;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df ** 2)
    + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3);
}

function variance(xs: readonly number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}
const avg = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Per-family effects: mean over the family's tasks of (candMean - baseMean), its SE from
 *  the sample variances, Welch–Satterthwaite df, and the one-sided upper bound at
 *  alpha / nFamilies. */
export function familyEffects(tasks: readonly TaskArms[], opts: GuardOptions = {}): FamilyEffect[] {
  const minRuns = opts.minRunsPerArm ?? 2;
  const usable = tasks.filter((t) => t.baseScores.length >= minRuns && t.candScores.length >= minRuns);
  const groups = new Map<string, TaskArms[]>();
  for (const t of usable) {
    const f = t.taskFamily ?? 'unlabeled';
    groups.set(f, [...(groups.get(f) ?? []), t]);
  }
  const nFam = Math.max(1, groups.size);
  const alpha = opts.alpha ?? 0.05;
  const out: FamilyEffect[] = [];
  for (const [family, arms] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const k = arms.length;
    const effect = avg(arms.map((t) => avg(t.candScores) - avg(t.baseScores)));
    // Var(effect) = Σ_t (s_b²/n_b + s_c²/n_c) / k²; components feed Welch–Satterthwaite.
    const comps = arms.flatMap((t) => [
      { v: variance(t.baseScores) / t.baseScores.length / (k * k), df: t.baseScores.length - 1 },
      { v: variance(t.candScores) / t.candScores.length / (k * k), df: t.candScores.length - 1 },
    ]);
    const vSum = comps.reduce((a, c) => a + c.v, 0);
    const dfDen = comps.reduce((a, c) => a + (c.v * c.v) / c.df, 0);
    const df = vSum === 0 || dfDen === 0 ? Infinity : (vSum * vSum) / dfDen;
    const se = Math.sqrt(vSum);
    const upper = effect + tQuantile(1 - alpha / nFam, Math.max(1, df)) * se;
    out.push({ family, nTasks: k, effect: round4(effect), se: round4(se), df: Number.isFinite(df) ? round4(df) : 1e9, upper: round4(upper) });
  }
  return out;
}

function verdict(scope: 'step' | 'total', family: string, effect: number, se: number, q: number, margin: number): GuardVerdict {
  const upper = round4(effect + q * se);
  return { family, scope, effect: round4(effect), se: round4(se), upper, margin, blocked: effect < -margin && upper < 0 };
}

/** The STEP guard: one verdict per family of this candidate vs its base. */
export function stepGuards(families: readonly FamilyEffect[], opts: GuardOptions = {}): GuardVerdict[] {
  const p = 1 - (opts.alpha ?? 0.05) / Math.max(1, families.length);
  return families.map((f) => verdict('step', f.family, f.effect, f.se, tQuantile(p, Math.max(1, f.df)), opts.margin ?? 2));
}

/** Running per-family drift from the round-0 base: Σ effect and Σ variance of merged steps. */
export type DriftLedger = Map<string, { effect: number; variance: number; steps: number; df: number }>;

/** The TOTAL guard: the ledger plus this step, per family this step measured. */
export function totalGuards(ledger: DriftLedger, families: readonly FamilyEffect[], opts: GuardOptions = {}): GuardVerdict[] {
  const p = 1 - (opts.alpha ?? 0.05) / Math.max(1, families.length);
  return families.map((f) => {
    const prior = ledger.get(f.family);
    // conservative df for the sum: the smallest df of any step in it
    const df = Math.max(1, Math.min(f.df, prior?.df ?? Infinity));
    return verdict('total', f.family, (prior?.effect ?? 0) + f.effect, Math.sqrt((prior?.variance ?? 0) + f.se ** 2), tQuantile(p, df), opts.totalMargin ?? 5);
  });
}

/** Add a merged step's family effects to the drift ledger (mutates and returns it). */
export function recordDrift(ledger: DriftLedger, families: readonly FamilyEffect[]): DriftLedger {
  for (const f of families) {
    const prior = ledger.get(f.family) ?? { effect: 0, variance: 0, steps: 0, df: Infinity };
    ledger.set(f.family, { effect: round4(prior.effect + f.effect), variance: prior.variance + f.se ** 2, steps: prior.steps + 1, df: Math.min(prior.df, f.df) });
  }
  return ledger;
}

/** One-line summary of the blocking guards (empty when none block). */
export function describeGuardBlocks(vs: readonly GuardVerdict[]): string {
  return vs.filter((v) => v.blocked)
    .map((v) => `${v.family} ${v.scope === 'step' ? 'step' : 'total'} ${v.effect} (upper ${v.upper} < 0, margin -${v.margin})`)
    .join('; ');
}
