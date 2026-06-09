/**
 * AutoResearchStats — the Monte-Carlo keep/discard gate.
 *
 * This is the statistical immune system of the recursive auto-research loop. A
 * raw `delta > 0` WILL fool a self-improvement loop: with enough parallel
 * experiments, some "win" on noise alone, the loop merges the noise, and it
 * compounds. This module replaces raw deltas with three rigorous tests:
 *
 *   1. BOOTSTRAP CI on the aggregate score delta — keep only if the CI excludes 0.
 *   2. PERMUTATION TEST — a one-sided p-value for "candidate is better", computed
 *      under the exchangeability null (base/candidate labels are swappable).
 *   3. N-AWARE FWER — when N experiments run in parallel (a swarm), the keep bar
 *      tightens to control the family-wise error rate. Without this a swarm
 *      confidently merges noise (multiple-comparisons trap).
 *
 * REPRODUCIBILITY: every test is driven by a SEEDED PRNG (mulberry32). Same data
 * + same seed → same p-value and CI. This is deliberate: the auto-research record
 * is meant to be public + verifiable (Layer 3), so a decision must be
 * reproducible by anyone re-running the gate on the same records.
 *
 * STRUCTURE: resampling is done at the RUN level WITHIN each task, then averaged
 * across tasks. This respects the per-task structure (a task with more runs
 * doesn't dominate; within-task noise is captured) — the correct unit for "did
 * the harness version improve the eval".
 *
 * Pure functions, no I/O. The caller (VersionComparison → ExperimentLedger)
 * feeds per-task score arrays and writes the returned verdict via
 * `ExperimentLedger.decide()`.
 */

/** RNG returning a float in [0, 1). Seeded for reproducibility. */
export type RNG = () => number;

/** mulberry32 — tiny, fast, well-distributed seeded PRNG. Deterministic. */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function (): number {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal per-task input: the raw per-run scores for each arm. */
export interface TaskArms {
  baseScores: number[];
  candScores: number[];
}

export interface GateOptions {
  /** family-wise significance level (default 0.05). */
  alpha?: number;
  /** number of experiments in the parallel family — the FWER N. Default 1
   *  (no family; Šidák collapses to alpha). The swarm passes its true breadth. */
  nFamilyExperiments?: number;
  bootstrapIterations?: number;   // default 2000
  permutationIterations?: number; // default 2000
  /** central CI mass (default 0.95 → 2.5/97.5 percentiles). */
  ci?: number;
  /** PRNG seed (default 0x9e3779b9). Override per-experiment to decorrelate. */
  seed?: number;
  rng?: RNG;
  /** minimum runs required in EACH arm of a task for it to count (default 2). */
  minRunsPerArm?: number;
}

export interface ExperimentVerdict {
  decision: 'keep' | 'discard' | 'pending';
  /** observed aggregate effect (mean across tasks of candMean - baseMean). */
  effect: number;
  pValue?: number;
  ciLow?: number;
  ciHigh?: number;
  /** true — the verdict was computed against the FWER-adjusted threshold. */
  fwerAdjusted: boolean;
  /** the family-adjusted alpha the p-value was tested against. */
  alphaAdjusted?: number;
  nRuns: number;
  nTasks: number;
  reason: string;
}

const DEFAULT_SEED = 0x9e3779b9;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/** Resample an array with replacement (bootstrap). */
function resample(xs: number[], rng: RNG): number[] {
  const n = xs.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = xs[(rng() * n) | 0]!;
  return out;
}

/** Fisher-Yates shuffle (in place) using the seeded RNG. */
function shuffle<T>(xs: T[], rng: RNG): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = xs[i]!; xs[i] = xs[j]!; xs[j] = tmp;
  }
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx]!;
}

/** Observed aggregate effect: mean across tasks of (candMean - baseMean). */
export function aggregateEffect(tasks: TaskArms[]): number {
  if (tasks.length === 0) return 0;
  return mean(tasks.map(t => mean(t.candScores) - mean(t.baseScores)));
}

/**
 * Bootstrap percentile CI on the aggregate effect. Resamples runs within each
 * arm of each task, recomputes the aggregate, repeats. Keep requires ciLow > 0.
 */
export function bootstrapCI(
  tasks: TaskArms[],
  opts: { iterations?: number; ci?: number; rng: RNG },
): { ciLow: number; ciHigh: number; effect: number } {
  const iterations = opts.iterations ?? 2000;
  const ci = opts.ci ?? 0.95;
  const stats: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const taskDeltas = tasks.map(t => mean(resample(t.candScores, opts.rng)) - mean(resample(t.baseScores, opts.rng)));
    stats.push(mean(taskDeltas));
  }
  stats.sort((x, y) => x - y);
  const lowQ = (1 - ci) / 2;
  return {
    ciLow: round4(percentile(stats, lowQ)),
    ciHigh: round4(percentile(stats, 1 - lowQ)),
    effect: round4(aggregateEffect(tasks)),
  };
}

/**
 * One-sided permutation p-value for "candidate > base". Within each task, pools
 * the two arms and relabels at random into the original arm sizes (the
 * exchangeability null), recomputes the aggregate effect, and measures how often
 * the permuted effect meets or beats the observed one. Add-one estimator
 * (never returns exactly 0 — a permutation p-value can't certify impossibility).
 */
export function permutationPValue(
  tasks: TaskArms[],
  opts: { iterations?: number; rng: RNG },
): number {
  const iterations = opts.iterations ?? 2000;
  const observed = aggregateEffect(tasks);
  let atLeastAsExtreme = 0;
  for (let p = 0; p < iterations; p++) {
    const permDeltas = tasks.map(t => {
      const pooled = [...t.baseScores, ...t.candScores];
      shuffle(pooled, opts.rng);
      const nb = t.baseScores.length;
      const permBase = pooled.slice(0, nb);
      const permCand = pooled.slice(nb);
      return mean(permCand) - mean(permBase);
    });
    if (mean(permDeltas) >= observed) atLeastAsExtreme++;
  }
  return round4((atLeastAsExtreme + 1) / (iterations + 1));
}

/**
 * Šidák family-wise threshold: the per-experiment alpha that holds the
 * family-wise error at `alpha` across N independent experiments.
 * `1 - (1 - alpha)^(1/N)`. Tighter than alpha, slightly looser than Bonferroni.
 */
export function sidakThreshold(alpha: number, nExperiments: number): number {
  const n = Math.max(1, nExperiments);
  return round4(1 - Math.pow(1 - alpha, 1 / n));
}

/**
 * Monte-Carlo FWER threshold. Simulates the joint null of N experiments and
 * returns the per-experiment p-value cutoff that controls the family-wise error
 * at `alpha` (the alpha-quantile of the family minimum p-value). With independent
 * experiments this reproduces Šidák — and that's the point: it VALIDATES the
 * analytic bar and is the extension point for correlated experiments (shared
 * tasks), where the true threshold is less conservative than Bonferroni/Šidák.
 * A `correlation` hook can later inject a copula; for now experiments are modeled
 * independent (conservative, correct).
 */
export function mcFwerThreshold(
  alpha: number,
  nExperiments: number,
  opts: { iterations?: number; rng: RNG },
): number {
  const n = Math.max(1, nExperiments);
  if (n === 1) return round4(alpha);
  const iterations = opts.iterations ?? 5000;
  const minPs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let minP = 1;
    for (let j = 0; j < n; j++) {
      const u = opts.rng(); // null p-value ~ Uniform(0,1)
      if (u < minP) minP = u;
    }
    minPs.push(minP);
  }
  minPs.sort((a, b) => a - b);
  // cutoff = alpha-quantile of the family-minimum-p distribution
  return round4(percentile(minPs, alpha));
}

/**
 * The full gate. Produces the keep/discard/pending verdict for one experiment,
 * tested against the FWER-adjusted threshold for a family of
 * `nFamilyExperiments`. Decision rule:
 *   - PENDING  if no task has >= minRunsPerArm in both arms (not enough data).
 *   - KEEP     if ciLow > 0 AND pValue <= alphaAdjusted (real, significant gain).
 *   - DISCARD  otherwise.
 *
 * The returned object maps directly onto ExperimentLedger.decide()'s
 * DecisionUpdate (decision/pValue/ciLow/ciHigh/fwerAdjusted/nRuns/reason).
 */
export function decideExperiment(tasks: TaskArms[], opts: GateOptions = {}): ExperimentVerdict {
  const alpha = opts.alpha ?? 0.05;
  const nFamily = opts.nFamilyExperiments ?? 1;
  const minRuns = opts.minRunsPerArm ?? 2;
  const rng = opts.rng ?? mulberry32(opts.seed ?? DEFAULT_SEED);

  const usable = tasks.filter(t => t.baseScores.length >= minRuns && t.candScores.length >= minRuns);
  const nRuns = tasks.reduce((s, t) => s + t.baseScores.length + t.candScores.length, 0);

  if (usable.length === 0) {
    return {
      decision: 'pending',
      effect: round4(aggregateEffect(tasks)),
      fwerAdjusted: false,
      nRuns,
      nTasks: tasks.length,
      reason: `insufficient data: no task has >= ${minRuns} runs in both arms`,
    };
  }

  const { ciLow, ciHigh, effect } = bootstrapCI(usable, { iterations: opts.bootstrapIterations, ci: opts.ci, rng });
  const pValue = permutationPValue(usable, { iterations: opts.permutationIterations, rng });
  const alphaAdjusted = mcFwerThreshold(alpha, nFamily, { rng });

  const ciExcludesZero = ciLow > 0;
  const significant = pValue <= alphaAdjusted;
  const keep = ciExcludesZero && significant;

  const reason = keep
    ? `keep: effect +${effect} (95% CI [${ciLow}, ${ciHigh}] excludes 0), p=${pValue} <= alpha_adj=${alphaAdjusted} (N=${nFamily})`
    : `discard: ${!ciExcludesZero ? `CI [${ciLow}, ${ciHigh}] includes 0` : `p=${pValue} > alpha_adj=${alphaAdjusted} (N=${nFamily})`}`;

  return {
    decision: keep ? 'keep' : 'discard',
    effect,
    pValue,
    ciLow,
    ciHigh,
    fwerAdjusted: true,
    alphaAdjusted,
    nRuns,
    nTasks: usable.length,
    reason,
  };
}
