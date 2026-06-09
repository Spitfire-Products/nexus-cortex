/**
 * `cortex autoresearch bench` — run a task set through the harness, GRADE each
 * output with the task's verifier, and write REAL scored records to
 * router-matrix.jsonl. This is the grader the decision layer was missing:
 * `evaluate` (the gate) only produces a meaningful keep/discard once arms carry
 * real qualitativeScores, which this command supplies.
 *
 * One invocation benches ONE harness build (records auto-stamped with its git
 * SHA, or --harness-ref). The swarm orchestrator runs it in the base worktree
 * and the candidate worktree, then calls `evaluate --base … --candidate …`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ModelRouterMatrix,
  runBench,
  parseTaskSet,
  type TaskSpec,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from '../config/utils.js';
import { serverRunner } from './harnessProcess.js';

export interface AutoResearchBenchOptions {
  taskSet?: string;
  experimentTag?: string;
  runs?: string;
  split?: string;
  model?: string;
  harnessRef?: string;
  benchmarkSource?: string;
  serverUrl?: string;
  json?: boolean;
}

/** Load tasks from a file (array or single object) or a directory of *.json. */
function loadTasks(taskSetPath: string): TaskSpec[] {
  const st = statSync(taskSetPath);
  const files = st.isDirectory()
    ? readdirSync(taskSetPath).filter(f => f.endsWith('.json')).map(f => join(taskSetPath, f))
    : [taskSetPath];
  const tasks: TaskSpec[] = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    tasks.push(...parseTaskSet(raw, f));
  }
  return tasks;
}

export async function autoResearchBench(options: AutoResearchBenchOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const projectRoot = findProjectRoot();

  if (!options.taskSet) { console.error(theme.colors.error('Error: --task-set is required')); process.exit(1); }
  if (!options.experimentTag) { console.error(theme.colors.error('Error: --experiment-tag is required')); process.exit(1); }

  const split = (options.split as 'train' | 'holdout' | undefined) ?? 'train';
  if (split !== 'train' && split !== 'holdout') {
    console.error(theme.colors.error("Error: --split must be 'train' or 'holdout'"));
    process.exit(1);
  }

  try {
    const tasks = loadTasks(options.taskSet!);
    if (tasks.length === 0) { console.error(theme.colors.error(`Error: no tasks found in ${options.taskSet}`)); process.exit(1); }

    const matrix = new ModelRouterMatrix(projectRoot);
    const serverUrl = options.serverUrl ?? process.env.CORTEX_SERVER_URL ?? 'http://localhost:4000';
    const model = options.model ?? process.env.DEFAULT_MODEL_ID;
    const runner = serverRunner(serverUrl, model);

    if (!options.json) {
      console.log();
      console.log(theme.colors.muted(` Benching ${tasks.length} task(s) × ${options.runs ?? 2} run(s) via ${serverUrl} [${split}]  tag=${options.experimentTag}`));
    }

    const summary = await runBench(tasks, runner, matrix, {
      experimentTag: options.experimentTag!,
      runs: options.runs ? Number(options.runs) : undefined,
      split,
      modelId: model,
      benchmarkSource: options.benchmarkSource,
      harnessRef: options.harnessRef,
      onRun: options.json ? undefined : (info) => {
        const mark = info.pass ? theme.colors.success('[OK]') : theme.colors.error('[FAIL]');
        console.log(theme.colors.muted(` ${mark} ${info.taskId} run ${info.run}: ${info.qualitativeScore}`));
      },
    });

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log();
    for (const t of summary.tasks) {
      console.log(` ${theme.colors.highlight(t.taskId.padEnd(28))} ${theme.colors.secondary(t.taskType)}  mean ${t.meanScore}  pass ${Math.round(t.passRate * 100)}%`);
    }
    console.log();
    console.log(theme.colors.muted(` ${summary.totalRuns} run(s) recorded → ${projectRoot}/.cortex/router-matrix.jsonl  (harnessRef ${summary.harnessRef ?? 'auto'})`));
    console.log(theme.colors.muted(` Next: cortex autoresearch evaluate --experiment-tag ${options.experimentTag} --base <ref> --candidate <ref> --branch <wt>`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
