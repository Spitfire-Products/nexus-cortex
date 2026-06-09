/**
 * `cortex autoresearch evaluate` — headless invocation of the keep/discard gate.
 *
 * This is the entry point a swarm member (or the cortex-bench flow) calls AFTER
 * it has recorded base-version and candidate-version benchmark runs to the
 * matrix (router-matrix.jsonl) under the same experimentTag. It runs the full
 * decision pipeline (regressionScan → Monte-Carlo gate → ledger.decide) and
 * writes the audited verdict to `.cortex/experiments.jsonl`.
 *
 * The output JSONL is THE integration boundary: the nexus Layer-3 STDB module
 * ingests it (header → `experiment`, results[] → `experiment_task_result`).
 * Nothing downstream re-derives the statistics — the decision is final here.
 *
 * Overfitting guard: keep/discard reads split='train' records; `--verify-holdout`
 * additionally runs the held-out gate (a candidate is only merge-eligible when
 * kept-on-train AND verified-on-holdout).
 */
import {
  ModelRouterMatrix,
  ExperimentLedger,
  evaluateAutoResearchExperiment,
  verifyOnHoldout,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from '../config/utils.js';

export interface AutoResearchEvaluateOptions {
  experimentTag?: string;
  base?: string;
  candidate?: string;
  branch?: string;
  deficiencyId?: string;
  benchmarkSource?: string;
  modelId?: string;
  nFamily?: string;
  alpha?: string;
  seed?: string;
  epsilon?: string;
  minRuns?: string;
  verifyHoldout?: boolean;
  json?: boolean;
}

function numOrUndef(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function autoResearchEvaluate(options: AutoResearchEvaluateOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const projectRoot = findProjectRoot();

  const required: Array<[keyof AutoResearchEvaluateOptions, string]> = [
    ['experimentTag', '--experiment-tag'],
    ['base', '--base'],
    ['candidate', '--candidate'],
    ['branch', '--branch'],
  ];
  const missing = required.filter(([k]) => !options[k]).map(([, flag]) => flag);
  if (missing.length > 0) {
    console.error(theme.colors.error(`Error: missing required option(s): ${missing.join(', ')}`));
    process.exit(1);
  }

  try {
    const matrix = new ModelRouterMatrix(projectRoot);
    const ledger = new ExperimentLedger(projectRoot);

    const gate = {
      alpha: numOrUndef(options.alpha),
      seed: numOrUndef(options.seed),
      minRunsPerArm: numOrUndef(options.minRuns),
    };

    const result = evaluateAutoResearchExperiment(matrix, ledger, {
      experimentTag: options.experimentTag!,
      baseRef: options.base!,
      candidateRef: options.candidate!,
      branch: options.branch!,
      deficiencyId: options.deficiencyId,
      benchmarkSource: options.benchmarkSource,
      modelId: options.modelId,
      nFamilyExperiments: numOrUndef(options.nFamily) ?? 1,
      gate,
      epsilon: numOrUndef(options.epsilon),
    });

    let holdout = null;
    if (options.verifyHoldout) {
      holdout = verifyOnHoldout(matrix, {
        baseRef: options.base!,
        candidateRef: options.candidate!,
        benchmarkSource: options.benchmarkSource,
        modelId: options.modelId,
        nFamilyExperiments: numOrUndef(options.nFamily) ?? 1,
        gate,
        epsilon: numOrUndef(options.epsilon),
      });
    }

    // Merge-eligibility: kept on train AND (if checked) verified on holdout.
    const mergeEligible =
      result.verdict.decision === 'keep' &&
      result.verdict.fwerAdjusted === true &&
      (!options.verifyHoldout || holdout?.decision === 'keep');

    if (options.json) {
      console.log(JSON.stringify({
        record: result.record,
        verdict: result.verdict,
        regressedTasks: result.regressedTasks,
        holdoutVerdict: holdout,
        mergeEligible,
      }, null, 2));
      return;
    }

    const v = result.verdict;
    const decColor =
      v.decision === 'keep' ? theme.colors.success
      : v.decision === 'discard' ? theme.colors.error
      : theme.colors.muted;

    console.log();
    console.log(` ${theme.colors.highlight('Experiment')}   ${options.experimentTag}  (${options.base} → ${options.candidate})`);
    console.log(` ${theme.colors.highlight('Decision')}     ${decColor(v.decision.toUpperCase())}`);
    console.log(` ${theme.colors.highlight('Effect')}       ${v.effect >= 0 ? '+' : ''}${v.effect}  (95% CI [${v.ciLow ?? '—'}, ${v.ciHigh ?? '—'}])`);
    console.log(` ${theme.colors.highlight('p-value')}      ${v.pValue ?? '—'}  vs alpha_adj ${v.alphaAdjusted ?? '—'}  (N=${numOrUndef(options.nFamily) ?? 1}, FWER ${v.fwerAdjusted ? 'on' : 'off'})`);
    console.log(` ${theme.colors.highlight('Runs/Tasks')}   ${v.nRuns} runs over ${v.nTasks} task(s)`);
    if (result.regressedTasks.length > 0) {
      console.log(` ${theme.colors.error('Regressions')}  ${result.regressedTasks.length} task(s): ${result.regressedTasks.join(', ')}`);
    }
    if (options.verifyHoldout) {
      const hd = holdout
        ? `${holdout.decision.toUpperCase()} (effect ${holdout.effect >= 0 ? '+' : ''}${holdout.effect}, CI [${holdout.ciLow ?? '—'}, ${holdout.ciHigh ?? '—'}])`
        : theme.colors.muted('no held-out evidence — unverifiable');
      console.log(` ${theme.colors.highlight('Holdout')}      ${hd}`);
    }
    console.log(` ${theme.colors.highlight('Mergeable')}    ${mergeEligible ? theme.colors.success('YES') : theme.colors.muted('no')}`);
    console.log(theme.colors.muted(` Recorded → ${projectRoot}/.cortex/experiments.jsonl`));
    console.log();
    console.log(theme.colors.muted(` ${v.reason}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
