/**
 * AutoResearchGate — the one callable that turns benchmark records into a
 * recorded keep/discard decision. This is the API Layer 2 (the nexus swarm)
 * consumes: a swarm member runs its experiment (writing benchmark records to the
 * matrix under its experimentTag + candidateRef), then calls `evaluateExperiment`
 * here to get an audited, FWER-adjusted verdict written to the ExperimentLedger.
 *
 * It wires the three decision-layer pieces together so nobody downstream has to:
 *   1. VersionComparison.regressionScan / compareVersions — pull the per-task
 *      base-vs-candidate evidence from the matrix (split='train' only).
 *   2. AutoResearchStats.decideExperiment — the Monte-Carlo gate.
 *   3. ExperimentLedger.open + setResults + decide — persist the audited record.
 *
 * The swarm must NOT reimplement any of this — call the gate, read keep/discard.
 *
 * OVERFITTING GUARD: the verdict here is computed from split='train' records.
 * `verifyOnHoldout` is the separate, mandatory second gate — a kept candidate is
 * only merge-eligible after it ALSO clears held-out. `fixed` ≠ `verified`.
 */

import type { ModelRouterMatrix } from './ModelRouterMatrix.js';
import { ExperimentLedger, type ExperimentRecord } from './ExperimentLedger.js';
import { regressionScan, toTaskResult, type TaskComparison, type RegressionReport } from './VersionComparison.js';
import { decideExperiment, type GateOptions, type ExperimentVerdict, type TaskArms } from './AutoResearchStats.js';

export interface EvaluateInput {
  experimentTag: string;
  baseRef: string;
  candidateRef: string;
  branch: string;
  /** deficiency this experiment addresses (links the ledger to the backlog). */
  deficiencyId?: string;
  benchmarkSource?: string;
  /** which model's records to compare (omit = all models pooled). */
  modelId?: string;
  /** how many experiments are running in the parallel family (FWER N). */
  nFamilyExperiments?: number;
  /** statistical gate knobs (alpha, iterations, seed, minRunsPerArm, …). */
  gate?: Omit<GateOptions, 'nFamilyExperiments'>;
  /** regression dead-band on the 0-100 scale (default 0.5). */
  epsilon?: number;
}

export interface EvaluateResult {
  record: ExperimentRecord;
  verdict: ExperimentVerdict;
  regression: RegressionReport;
  /** regressed task fingerprints — populated even on a 'keep' so the caller can
   *  see collateral damage. A keep with regressions is a caller red flag. */
  regressedTasks: string[];
}

/**
 * Run the full decision pipeline for one experiment and persist the audited
 * verdict to the ledger. Idempotent per experimentTag (re-running re-snapshots).
 */
export function evaluateExperiment(
  matrix: ModelRouterMatrix,
  ledger: ExperimentLedger,
  input: EvaluateInput,
): EvaluateResult {
  const { experimentTag, baseRef, candidateRef, branch } = input;

  // 1. Gather per-task evidence across every task the candidate ran (train split).
  const regression = regressionScan(matrix, candidateRef, baseRef, {
    split: 'train',
    benchmarkSource: input.benchmarkSource,
    modelId: input.modelId,
    epsilon: input.epsilon,
  });
  const comparisons: TaskComparison[] = [
    ...regression.improvements,
    ...regression.regressions,
    ...regression.neutral,
  ];

  // 2. Open/refresh the ledger record with the per-task results.
  ledger.open({
    experimentTag, baseRef, candidateRef, branch,
    deficiencyId: input.deficiencyId,
    benchmarkSource: input.benchmarkSource,
    results: comparisons.map(c => toTaskResult(experimentTag, c)),
  });

  // 3. Monte-Carlo gate over the raw per-run arrays (sufficient cells only —
  //    decideExperiment re-applies the minRunsPerArm filter itself).
  const arms: TaskArms[] = comparisons.map(c => ({ baseScores: c.baseScores, candScores: c.candScores }));
  const verdict = decideExperiment(arms, {
    ...input.gate,
    nFamilyExperiments: input.nFamilyExperiments ?? 1,
  });

  // 4. Persist the audited verdict. A 'keep' that introduced regressions gets
  //    that flagged in the reason — the loop should not silently merge collateral
  //    damage even when the aggregate effect is positive.
  const regressedTasks = regression.regressions.map(r => r.taskFingerprint);
  const reason = verdict.decision === 'keep' && regressedTasks.length > 0
    ? `${verdict.reason} | WARNING: ${regressedTasks.length} task(s) regressed: ${regressedTasks.join(', ')}`
    : verdict.reason;

  const record = ledger.decide(experimentTag, {
    decision: verdict.decision,
    pValue: verdict.pValue,
    ciLow: verdict.ciLow,
    ciHigh: verdict.ciHigh,
    fwerAdjusted: verdict.fwerAdjusted,
    nRuns: verdict.nRuns,
    reason,
  })!;

  return { record, verdict, regression, regressedTasks };
}

/**
 * Held-out verification — the SECOND, mandatory gate before a kept candidate may
 * merge. Re-runs the Monte-Carlo gate on split='holdout' records only. A
 * candidate is merge-eligible iff it was kept on train AND passes here. This is
 * the structural defense against overfitting to the discovery tasks: a fix tuned
 * to win the train eval will not generalize to held-out tasks it never saw.
 * Returns null when there are no holdout records yet (cannot verify → not
 * verified → not mergeable).
 */
export function verifyOnHoldout(
  matrix: ModelRouterMatrix,
  input: Pick<EvaluateInput, 'baseRef' | 'candidateRef' | 'benchmarkSource' | 'modelId' | 'nFamilyExperiments' | 'gate' | 'epsilon'>,
): ExperimentVerdict | null {
  const holdout = regressionScan(matrix, input.candidateRef, input.baseRef, {
    split: 'holdout',
    benchmarkSource: input.benchmarkSource,
    modelId: input.modelId,
    epsilon: input.epsilon,
  });
  const comparisons = [...holdout.improvements, ...holdout.regressions, ...holdout.neutral];
  if (comparisons.length === 0) return null; // no held-out evidence → unverifiable
  const arms: TaskArms[] = comparisons.map(c => ({ baseScores: c.baseScores, candScores: c.candScores }));
  return decideExperiment(arms, { ...input.gate, nFamilyExperiments: input.nFamilyExperiments ?? 1 });
}
