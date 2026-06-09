/**
 * VersionComparison — task-by-task base-vs-candidate harness comparison.
 *
 * The auto-research loop asks one question per experiment: did harness version
 * `candidateRef` actually do better than `baseRef` on the fixed-eval tasks, or is
 * the apparent difference noise? This module produces the per-task evidence
 * (raw per-run score arrays + means + deltas) that the Monte-Carlo gate
 * (AutoResearchStats) turns into a keep/discard decision, and that the
 * ExperimentLedger records.
 *
 * OVERFITTING GUARD (enforced here): comparisons read `split:'train'` records by
 * default. Holdout records are NEVER used for keep/discard — only to confirm a
 * kept candidate generalizes. The caller verifying generalization passes
 * split:'holdout' explicitly.
 *
 * SCORE: the per-run scalar is `qualitativeScore` (0-100). Graders already fold
 * correctness into it (and for pass/fail benchmarks like swebench the grader
 * emits 100/0). The bootstrap/permutation gate resamples these per-run values,
 * so this module returns the raw arrays, not just the means.
 */

import type { ModelRouterMatrix, BenchmarkRecord } from './ModelRouterMatrix.js';

/** Per-task comparison evidence for one (taskFingerprint, base, candidate) cell. */
export interface TaskComparison {
  taskFingerprint: string;
  baseRef: string;
  candidateRef: string;
  /** raw per-run scores on the base version (for bootstrap/permutation). */
  baseScores: number[];
  /** raw per-run scores on the candidate version. */
  candScores: number[];
  baseMean: number;
  candMean: number;
  /** candMean - baseMean. Positive = candidate improved the task. */
  delta: number;
  baseN: number;
  candN: number;
  /** true when BOTH arms have >= minN runs — the minimum for any trustworthy
   *  delta. Cells failing this should not feed a keep decision. */
  sufficient: boolean;
}

export interface CompareOptions {
  split?: 'train' | 'holdout';
  benchmarkSource?: string;
  modelId?: string;
  /** minimum runs per arm for `sufficient` (default 2 — n>=2 significance rule). */
  minN?: number;
  /** per-run scalar extractor; defaults to qualitativeScore. */
  scoreOf?: (r: BenchmarkRecord) => number;
}

export interface RegressionReport {
  candidateRef: string;
  baseRef: string;
  /** candMean < baseMean - epsilon, with sufficient runs. The blockers. */
  regressions: TaskComparison[];
  /** candMean > baseMean + epsilon, with sufficient runs. */
  improvements: TaskComparison[];
  /** within epsilon, or insufficient runs to judge. */
  neutral: TaskComparison[];
  /** tasks the candidate ran but the base never did — can't compare. */
  uncompared: string[];
  /** mean of all sufficient-cell deltas. Quick directional summary, NOT a
   *  significance verdict (that's AutoResearchStats). */
  meanDelta: number;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

const defaultScoreOf = (r: BenchmarkRecord): number => r.qualitativeScore;

/**
 * Compare a single task across two harness versions. Returns the raw per-run
 * score arrays plus summary stats. Empty arrays when a version never ran the
 * task (sufficient=false).
 */
export function compareVersions(
  matrix: ModelRouterMatrix,
  taskFingerprint: string,
  baseRef: string,
  candidateRef: string,
  opts: CompareOptions = {},
): TaskComparison {
  const split = opts.split ?? 'train';
  const scoreOf = opts.scoreOf ?? defaultScoreOf;
  const minN = opts.minN ?? 2;

  const pull = (harnessRef: string): number[] =>
    matrix
      .getRecords({ taskFingerprint, harnessRef, split, benchmarkSource: opts.benchmarkSource, modelId: opts.modelId })
      .map(scoreOf)
      .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));

  const baseScores = pull(baseRef);
  const candScores = pull(candidateRef);
  const baseMean = round3(mean(baseScores));
  const candMean = round3(mean(candScores));

  return {
    taskFingerprint,
    baseRef,
    candidateRef,
    baseScores,
    candScores,
    baseMean,
    candMean,
    delta: round3(candMean - baseMean),
    baseN: baseScores.length,
    candN: candScores.length,
    sufficient: baseScores.length >= minN && candScores.length >= minN,
  };
}

/**
 * Compare EVERY task the candidate version ran against the base version. The
 * broad regression net: a candidate that improves its target task but quietly
 * breaks three others must not be kept. `epsilon` is the dead-band that ignores
 * trivial score wobble (default 0.5 on the 0-100 scale).
 */
export function regressionScan(
  matrix: ModelRouterMatrix,
  candidateRef: string,
  baseRef: string,
  opts: CompareOptions & { epsilon?: number } = {},
): RegressionReport {
  const split = opts.split ?? 'train';
  const epsilon = opts.epsilon ?? 0.5;
  const fingerprints = matrix.taskFingerprintsAt(candidateRef, split);

  const regressions: TaskComparison[] = [];
  const improvements: TaskComparison[] = [];
  const neutral: TaskComparison[] = [];
  const uncompared: string[] = [];
  const sufficientDeltas: number[] = [];

  for (const fp of fingerprints) {
    const cmp = compareVersions(matrix, fp, baseRef, candidateRef, opts);
    if (cmp.baseN === 0) { uncompared.push(fp); continue; }
    if (!cmp.sufficient) { neutral.push(cmp); continue; }
    sufficientDeltas.push(cmp.delta);
    if (cmp.delta < -epsilon) regressions.push(cmp);
    else if (cmp.delta > epsilon) improvements.push(cmp);
    else neutral.push(cmp);
  }

  // Worst regressions first; biggest improvements first.
  regressions.sort((a, b) => a.delta - b.delta);
  improvements.sort((a, b) => b.delta - a.delta);

  return {
    candidateRef,
    baseRef,
    regressions,
    improvements,
    neutral,
    uncompared,
    meanDelta: round3(mean(sufficientDeltas)),
  };
}

/** Adapt a TaskComparison to the ExperimentLedger child-row shape. */
export function toTaskResult(experimentTag: string, cmp: TaskComparison) {
  return {
    experimentTag,
    taskFingerprint: cmp.taskFingerprint,
    baseScore: cmp.baseMean,
    candScore: cmp.candMean,
    delta: cmp.delta,
    baseN: cmp.baseN,
    candN: cmp.candN,
  };
}
