/**
 * `cortex autoresearch experiment` — the full single-experiment lifecycle.
 *
 * Builds the candidate (and optionally base) checkout, serves each on its own
 * isolated port, benches both arms (train + optional holdout) into ONE shared
 * `.cortex` store, runs the keep/discard gate + held-out verification, and emits
 * the audited verdict + the JSONL artifact a downstream ingest consumes.
 *
 * This is the piece that owns the "two builds, not one relabel" correctness: each
 * arm is served by a server BUILT FROM ITS OWN CODE, so the comparison is real.
 * Servers run with MODEL_ROUTER_RECORD off; only the bench's graded records land
 * in the shared store. Teardown is guaranteed in `finally`.
 *
 * Scope: this is a HARNESS-CODE experiment (base build vs candidate build,
 * compared by git SHA). Model/config experiments (same code, different --model)
 * use the lower-level `bench` + `evaluate` directly.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  ModelRouterMatrix,
  ExperimentLedger,
  runExperiment,
  parseTaskSet,
  type TaskSpec,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from '../config/utils.js';
import { freePort, gitShortSha, CortexTarget, type ExperimentTarget, type PreparedArm } from './harnessProcess.js';
import { CommandTarget } from './commandRunner.js';

export interface AutoResearchExperimentOptions {
  experimentTag?: string;
  candidateDir?: string;
  baseDir?: string;
  taskSet?: string;
  holdoutSet?: string;
  branch?: string;
  nFamily?: string;
  runs?: string;
  model?: string;
  deficiencyId?: string;
  benchmarkSource?: string;
  baseRef?: string;
  candidateRef?: string;
  buildBase?: boolean;
  noBuild?: boolean;
  basePort?: string;
  candidatePort?: string;
  cortexDir?: string;
  seed?: string;
  alpha?: string;
  epsilon?: string;
  minRuns?: string;
  json?: boolean;
  /** Non-cortex target: grade a shell command per task (with --build-cmd/--accept-exit)
   *  instead of building+serving a cortex server. Both arms use the same command; the
   *  base/candidate difference is the worktree the command runs in. */
  runCmd?: string;
  buildCmd?: string;
  acceptExit?: string;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function loadTasks(p: string): TaskSpec[] {
  const st = statSync(p);
  const files = st.isDirectory()
    ? readdirSync(p).filter(f => f.endsWith('.json')).map(f => join(p, f))
    : [p];
  const out: TaskSpec[] = [];
  for (const f of files) out.push(...parseTaskSet(JSON.parse(readFileSync(f, 'utf8')), f));
  return out;
}

export async function autoResearchExperiment(options: AutoResearchExperimentOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const json = !!options.json;
  const log = (m: string) => { if (!json) console.log(theme.colors.muted(` ${m}`)); };

  const projectRoot = findProjectRoot();
  const candidateDir = options.candidateDir;
  const baseDir = options.baseDir ?? projectRoot;
  const cortexDir = options.cortexDir ?? projectRoot;

  const missing: string[] = [];
  if (!options.experimentTag) missing.push('--experiment-tag');
  if (!candidateDir) missing.push('--candidate-dir');
  if (!options.taskSet) missing.push('--task-set');
  if (missing.length) { console.error(theme.colors.error(`Error: missing ${missing.join(', ')}`)); process.exit(1); }

  const arms: PreparedArm[] = [];
  try {
    const trainTasks = loadTasks(options.taskSet!);
    const holdoutTasks = options.holdoutSet ? loadTasks(options.holdoutSet) : undefined;
    if (trainTasks.length === 0) { console.error(theme.colors.error('Error: empty --task-set')); process.exit(1); }

    // Distinct arm labels: git SHA when the dir is a checkout, else its basename.
    const refFor = (dir: string, override?: string) => {
      if (override) return override;
      const sha = gitShortSha(dir);
      return sha !== 'unknown' ? sha : basename(dir);
    };
    const baseRef = refFor(baseDir, options.baseRef);
    const candidateRef = refFor(candidateDir!, options.candidateRef);
    if (baseRef === candidateRef) {
      console.error(theme.colors.error(`Error: base and candidate resolve to the same ref (${baseRef}) — an experiment needs two distinct arms. Pass --base-ref/--candidate-ref to label, or use a real candidate worktree.`));
      process.exit(1);
    }

    const model = options.model ?? process.env.DEFAULT_MODEL_ID;

    // Select the target: a shell-command target (any project) or the default cortex server.
    const target: ExperimentTarget = options.runCmd
      ? new CommandTarget({
          template: options.runCmd,
          buildCmd: options.buildCmd,
          acceptExitCodes: (options.acceptExit ?? '0').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n)),
        })
      : new CortexTarget();

    if (!json) {
      console.log();
      console.log(` ${theme.colors.highlight('Experiment')}  ${options.experimentTag}  ${baseRef} → ${candidateRef}  [${target.kind}]`);
    }

    // Prepare each arm (build if asked + start its runner). Candidate builds unless
    // --no-build; base builds only with --build-base. Each arm gets its own reserved port
    // (server targets bind it; command targets ignore it).
    const basePort = num(options.basePort) ?? await freePort();
    const candPort = num(options.candidatePort) ?? await freePort();
    const baseArm = await target.prepare(baseDir, { port: basePort, model, build: !options.noBuild && !!options.buildBase, log });
    arms.push(baseArm);
    const candArm = await target.prepare(candidateDir!, { port: candPort, model, build: !options.noBuild, log });
    arms.push(candArm);

    // Bench both arms + gate (shared store at cortexDir/.cortex).
    const matrix = new ModelRouterMatrix(cortexDir);
    const ledger = new ExperimentLedger(cortexDir);

    const result = await runExperiment(matrix, ledger, {
      baseRunner: baseArm.runner,
      candidateRunner: candArm.runner,
    }, {
      experimentTag: options.experimentTag!,
      baseRef, candidateRef,
      branch: options.branch ?? candidateRef,
      trainTasks, holdoutTasks,
      runs: num(options.runs),
      nFamily: num(options.nFamily) ?? 1,
      modelId: model,
      deficiencyId: options.deficiencyId,
      benchmarkSource: options.benchmarkSource,
      gate: { alpha: num(options.alpha), seed: num(options.seed), minRunsPerArm: num(options.minRuns) },
      epsilon: num(options.epsilon),
      onProgress: log,
    });

    const out = {
      experimentTag: options.experimentTag,
      baseRef, candidateRef, branch: options.branch ?? candidateRef,
      verdict: result.verdict,
      holdoutVerdict: result.holdoutVerdict,
      regressedTasks: result.regressedTasks,
      mergeEligible: result.mergeEligible,
      benchSummaries: result.benchSummaries,
      cortexDir,
      jsonlPaths: {
        matrix: join(cortexDir, '.cortex', 'router-matrix.jsonl'),
        experiments: join(cortexDir, '.cortex', 'experiments.jsonl'),
        backlog: join(cortexDir, '.cortex', 'research-backlog.jsonl'),
      },
    };

    if (json) { console.log(JSON.stringify(out, null, 2)); return; }

    const v = result.verdict;
    const dc = v.decision === 'keep' ? theme.colors.success : v.decision === 'discard' ? theme.colors.error : theme.colors.muted;
    console.log();
    console.log(` ${theme.colors.highlight('Decision')}    ${dc(v.decision.toUpperCase())}   effect ${v.effect >= 0 ? '+' : ''}${v.effect}  CI [${v.ciLow ?? '—'}, ${v.ciHigh ?? '—'}]  p=${v.pValue ?? '—'} vs ${v.alphaAdjusted ?? '—'} (N=${num(options.nFamily) ?? 1})`);
    console.log(` ${theme.colors.highlight('Holdout')}     ${result.holdoutVerdict ? result.holdoutVerdict.decision.toUpperCase() + ` (effect ${result.holdoutVerdict.effect >= 0 ? '+' : ''}${result.holdoutVerdict.effect})` : theme.colors.muted('not provided → not verifiable')}`);
    if (result.regressedTasks.length) console.log(` ${theme.colors.error('Regressions')} ${result.regressedTasks.length}: ${result.regressedTasks.join(', ')}`);
    console.log(` ${theme.colors.highlight('Mergeable')}   ${result.mergeEligible ? theme.colors.success('YES') : theme.colors.muted('no')}`);
    console.log(theme.colors.muted(` artifact → ${cortexDir}/.cortex/{router-matrix,experiments,research-backlog}.jsonl`));
    console.log();

  } catch (error: any) {
    if (json) console.log(JSON.stringify({ error: error.message }, null, 2));
    else console.error(theme.colors.error(`Error: ${error.message}`));
    process.exitCode = 1;
  } finally {
    for (const a of arms) a.stop();
  }
}
