/**
 * ExperimentRunner — the single-experiment measurement core.
 *
 * One auto-research experiment = bench a BASE harness build and a CANDIDATE
 * harness build on the same fixed-eval tasks (train + optional holdout), then run
 * the keep/discard gate. This module owns the *measurement* composition; the CLI
 * (`cortex autoresearch experiment`) owns the *lifecycle* (build each worktree,
 * serve each on its own port, teardown) and injects the two arms as
 * `HarnessRunner`s pointed at the running servers.
 *
 * CRITICAL (the "two builds, not one relabel" correctness): the two arms MUST be
 * backed by servers running DIFFERENT code (base build vs candidate build). This
 * module can't enforce that — it only sees two runners — so the CLI guarantees it
 * by serving each dir's own build. `harnessRef` labels each arm's records with
 * the git SHA the serving build came from; the gate compares by `harnessRef`.
 *
 * OVERFITTING DISCIPLINE: train drives keep/discard; holdout is a SEPARATE gate.
 * `mergeEligible` requires keep-on-train AND fwerAdjusted AND keep-on-holdout —
 * and is FALSE when no holdout was run (can't verify → not mergeable; fixed ≠
 * verified). The fixing agent must never have seen the holdout tasks (enforced
 * upstream).
 */

import { ModelRouterMatrix } from './ModelRouterMatrix.js';
import { ExperimentLedger } from './ExperimentLedger.js';
import { runBench, type TaskSpec, type HarnessRunner, type BenchSummary } from './BenchRunner.js';
import { evaluateExperiment, verifyOnHoldout } from './AutoResearchGate.js';
import type { ExperimentRecord } from './ExperimentLedger.js';
import type { ExperimentVerdict } from './AutoResearchStats.js';

export interface ExperimentArms {
  /** runner pointed at the BASE build's server. */
  baseRunner: HarnessRunner;
  /** runner pointed at the CANDIDATE build's server. */
  candidateRunner: HarnessRunner;
}

export interface RunExperimentOptions {
  experimentTag: string;
  /** git ref / label of the base build serving baseRunner. */
  baseRef: string;
  /** git ref / label of the candidate build serving candidateRunner. */
  candidateRef: string;
  branch: string;
  trainTasks: TaskSpec[];
  holdoutTasks?: TaskSpec[];
  runs?: number;            // per task per arm (default 2)
  nFamily?: number;         // FWER family width (parallel experiments this round)
  modelId?: string;
  deficiencyId?: string;
  benchmarkSource?: string;
  gate?: { alpha?: number; seed?: number; minRunsPerArm?: number };
  epsilon?: number;
  onProgress?: (msg: string) => void;
  /** Effectiveness-arm labels recorded on BOTH base + candidate records (the experiment
   *  isolates the harness-version variable, so both arms share the same dispatch config).
   *  Lets later queries ask "at this temperature / strategy, did the candidate win?".
   *  Omitted ⇒ falls back to the CORTEX_SUBAGENT_TEMPERATURE / CORTEX_ARM_STRATEGY env stamp. */
  temperature?: number;
  strategy?: string;
}

export interface ExperimentBenchSummaries {
  base: { train: BenchSummary; holdout?: BenchSummary };
  candidate: { train: BenchSummary; holdout?: BenchSummary };
}

export interface ExperimentResult {
  record: ExperimentRecord;
  verdict: ExperimentVerdict;
  regressedTasks: string[];
  holdoutVerdict: ExperimentVerdict | null;
  /** keep-on-train ∧ fwerAdjusted ∧ keep-on-holdout. FALSE without holdout. */
  mergeEligible: boolean;
  benchSummaries: ExperimentBenchSummaries;
}

/**
 * Bench both arms (train + optional holdout) into the shared matrix, then run the
 * gate + the held-out verification, and compute merge-eligibility. Pure of
 * process/lifecycle — the arms are injected runners, so this unit-tests with
 * scripted mock runners (no servers).
 */
export async function runExperiment(
  matrix: ModelRouterMatrix,
  ledger: ExperimentLedger,
  arms: ExperimentArms,
  opts: RunExperimentOptions,
): Promise<ExperimentResult> {
  const runs = opts.runs ?? 2;
  const log = opts.onProgress ?? (() => {});
  const benchOpts = (split: 'train' | 'holdout', harnessRef: string, runner: HarnessRunner, tasks: TaskSpec[]) =>
    runBench(tasks, runner, matrix, {
      experimentTag: opts.experimentTag,
      runs,
      split,
      modelId: opts.modelId,
      benchmarkSource: opts.benchmarkSource,
      harnessRef,
      temperature: opts.temperature,
      strategy: opts.strategy,
    });

  // 1. Train arms (drive keep/discard).
  log(`bench base/train @ ${opts.baseRef}`);
  const baseTrain = await benchOpts('train', opts.baseRef, arms.baseRunner, opts.trainTasks);
  log(`bench candidate/train @ ${opts.candidateRef}`);
  const candTrain = await benchOpts('train', opts.candidateRef, arms.candidateRunner, opts.trainTasks);

  // 2. Holdout arms (verify generalization), if a holdout set was provided.
  let baseHoldout: BenchSummary | undefined;
  let candHoldout: BenchSummary | undefined;
  if (opts.holdoutTasks && opts.holdoutTasks.length > 0) {
    log(`bench base/holdout @ ${opts.baseRef}`);
    baseHoldout = await benchOpts('holdout', opts.baseRef, arms.baseRunner, opts.holdoutTasks);
    log(`bench candidate/holdout @ ${opts.candidateRef}`);
    candHoldout = await benchOpts('holdout', opts.candidateRef, arms.candidateRunner, opts.holdoutTasks);
  }

  // 3. Keep/discard gate over the train records.
  log('gate (train)');
  const gateResult = evaluateExperiment(matrix, ledger, {
    experimentTag: opts.experimentTag,
    baseRef: opts.baseRef,
    candidateRef: opts.candidateRef,
    branch: opts.branch,
    deficiencyId: opts.deficiencyId,
    benchmarkSource: opts.benchmarkSource,
    nFamilyExperiments: opts.nFamily ?? 1,
    gate: opts.gate,
    epsilon: opts.epsilon,
  });

  // 4. Held-out verification (the mandatory second gate).
  const holdoutVerdict = (opts.holdoutTasks && opts.holdoutTasks.length > 0)
    ? verifyOnHoldout(matrix, {
        baseRef: opts.baseRef,
        candidateRef: opts.candidateRef,
        benchmarkSource: opts.benchmarkSource,
        nFamilyExperiments: opts.nFamily ?? 1,
        gate: opts.gate,
        epsilon: opts.epsilon,
      })
    : null;

  const mergeEligible =
    gateResult.verdict.decision === 'keep' &&
    gateResult.verdict.fwerAdjusted === true &&
    holdoutVerdict?.decision === 'keep';

  return {
    record: gateResult.record,
    verdict: gateResult.verdict,
    regressedTasks: gateResult.regressedTasks,
    holdoutVerdict,
    mergeEligible,
    benchSummaries: {
      base: { train: baseTrain, holdout: baseHoldout },
      candidate: { train: candTrain, holdout: candHoldout },
    },
  };
}
