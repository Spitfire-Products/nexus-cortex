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
import { join } from 'node:path';
import {
  ModelRouterMatrix,
  ExperimentLedger,
  runExperiment,
  parseTaskSet,
  type TaskSpec,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from '../config/utils.js';
import { serverRunner, startServer, freePort, gitShortSha, buildDir, type ServerHandle } from './harnessProcess.js';

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

  const servers: ServerHandle[] = [];
  try {
    const trainTasks = loadTasks(options.taskSet!);
    const holdoutTasks = options.holdoutSet ? loadTasks(options.holdoutSet) : undefined;
    if (trainTasks.length === 0) { console.error(theme.colors.error('Error: empty --task-set')); process.exit(1); }

    const baseRef = options.baseRef ?? gitShortSha(baseDir);
    const candidateRef = options.candidateRef ?? gitShortSha(candidateDir!);
    if (baseRef === candidateRef) {
      console.error(theme.colors.error(`Error: base and candidate resolve to the same ref (${baseRef}) — a harness-code experiment needs two distinct builds. Pass --base-ref/--candidate-ref to label, or use a real candidate worktree.`));
      process.exit(1);
    }

    if (!json) {
      console.log();
      console.log(` ${theme.colors.highlight('Experiment')}  ${options.experimentTag}  ${baseRef} → ${candidateRef}`);
    }

    // 1. Build (candidate always unless --no-build; base only with --build-base).
    if (!options.noBuild) {
      if (options.buildBase) await buildDir(baseDir, log);
      await buildDir(candidateDir!, log);
    }

    // 2. Serve each build on its own port.
    const basePort = num(options.basePort) ?? await freePort();
    const candPort = num(options.candidatePort) ?? await freePort();
    const baseServer = await startServer(baseDir, basePort, log);
    servers.push(baseServer);
    const candServer = await startServer(candidateDir!, candPort, log);
    servers.push(candServer);

    // 3. Bench both arms + gate (shared store at cortexDir/.cortex).
    const matrix = new ModelRouterMatrix(cortexDir);
    const ledger = new ExperimentLedger(cortexDir);
    const model = options.model ?? process.env.DEFAULT_MODEL_ID;

    const result = await runExperiment(matrix, ledger, {
      baseRunner: serverRunner(baseServer.url, model),
      candidateRunner: serverRunner(candServer.url, model),
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
    for (const s of servers) s.stop();
  }
}
