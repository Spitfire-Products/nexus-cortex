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
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ModelRouterMatrix,
  runBench,
  parseTaskSet,
  ResearchBacklog,
  type TaskSpec,
  type HarnessRunner,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from '../config/utils.js';
import { serverRunner } from './harnessProcess.js';
import { commandRunner } from './commandRunner.js';

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
  /** Seed a deficiency for every failing task into .cortex/research-backlog.jsonl
   *  (default true; holdout split never seeds). Pass false for candidate-worktree
   *  benches so a not-yet-fixed task doesn't re-stamp the discovery record. */
  seedBacklog?: boolean;
  /** Non-cortex target: grade a shell command per task instead of POSTing to a cortex
   *  server. `runCmd` is the per-task template ({prompt}/{case} substituted). Pair with
   *  `numeric` verifiers in the task set. */
  runCmd?: string;
  /** Optional one-shot build, run once in --cwd before benching the command target. */
  buildCmd?: string;
  /** Working dir for --run-cmd / --build-cmd (default: project root). */
  cwd?: string;
  /** Comma list of exit codes whose stdout is graded (default "0"). */
  acceptExit?: string;
  /** Effectiveness-arm labels recorded with each scored run, so the matrix can rank
   *  (model × temperature × strategy). Both fall back to the CORTEX_SUBAGENT_TEMPERATURE /
   *  CORTEX_ARM_STRATEGY env stamp when omitted. */
  temperature?: string;
  strategy?: string;
}

/** Normalize a raw CORTEX_TOOL_PROFILE value the way the server's ToolProfile
 *  resolver does (unknown → 'full', fail-open) so the stamp reflects what
 *  actually ran. Returns undefined for empty/unset (distinct from 'full'). */
function normalizeToolProfile(raw: string | undefined): 'full' | 'lean' | 'bash-only' | 'bash-plus' | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  return v === 'lean' || v === 'bash-only' || v === 'bash-plus' ? v : 'full';
}

/** Ask the target server for its effective CORTEX_TOOL_PROFILE via the /config
 *  route. Returns undefined when the server is unreachable or the route is
 *  missing (older builds) — the caller must warn, not guess. */
async function fetchServerToolProfile(serverUrl: string): Promise<'full' | 'lean' | 'bash-only' | 'bash-plus' | undefined> {
  try {
    const resp = await fetch(`${serverUrl}/config/CORTEX_TOOL_PROFILE`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return undefined;
    const data: any = await resp.json();
    return typeof data?.value === 'string' ? normalizeToolProfile(data.value) : undefined;
  } catch {
    return undefined;
  }
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
    const model = options.model ?? process.env.DEFAULT_MODEL_ID;
    const log = (m: string) => { if (!options.json) console.log(theme.colors.muted(` ${m}`)); };

    let runner: HarnessRunner;
    let source: string;
    // Tool-surface arm stamp (BenchmarkRecord.toolProfile). The CLI process
    // writes the records but the SERVER's env decides which tool surface the
    // runs actually used — so for server benches, resolve the profile from the
    // server (/config route) with the CLI's own env as fallback. Command-target
    // benches (--run-cmd) run in the CLI's env, so the legacy env stamp inside
    // ModelRouterMatrix.record() is already correct there.
    let toolProfile: 'full' | 'lean' | 'bash-only' | 'bash-plus' | undefined;
    const warn = (m: string) => console.error(theme.colors.warning(`[WARN] ${m}`));
    if (options.runCmd) {
      // Non-cortex command target: optionally build once, then grade a shell command per task.
      const cwd = options.cwd ? resolve(options.cwd) : projectRoot;
      const acceptExit = (options.acceptExit ?? '0').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n));
      if (options.buildCmd) {
        log(`Building target: ${options.buildCmd}  (cwd ${cwd})`);
        const b = spawnSync('sh', ['-c', options.buildCmd], { cwd, stdio: options.json ? 'ignore' : 'inherit' });
        if (b.status !== 0) { console.error(theme.colors.error(`Error: build command failed (exit ${b.status})`)); process.exit(1); }
      }
      runner = commandRunner({ cwd, template: options.runCmd, acceptExitCodes: acceptExit, log });
      source = `cmd "${options.runCmd}" (cwd ${cwd})`;
    } else {
      const serverUrl = options.serverUrl ?? process.env.CORTEX_SERVER_URL ?? 'http://localhost:4000';
      runner = serverRunner(serverUrl, model);
      source = serverUrl;

      const cliProfile = normalizeToolProfile(process.env.CORTEX_TOOL_PROFILE);
      const serverProfile = await fetchServerToolProfile(serverUrl);
      toolProfile = serverProfile ?? cliProfile;
      if (!serverProfile) {
        if (cliProfile) {
          warn(`could not read the server's tool profile (GET ${serverUrl}/config/CORTEX_TOOL_PROFILE) — stamping records from this CLI's env ('${cliProfile}'). Verify the server was started with the same CORTEX_TOOL_PROFILE or the A/B data is mislabeled.`);
        } else {
          warn(`server tool profile UNKNOWN (GET ${serverUrl}/config/CORTEX_TOOL_PROFILE failed) and CORTEX_TOOL_PROFILE is unset on this CLI — records will be stamped as 'full' (field omitted). If the server runs lean/bash-only, re-run with CORTEX_TOOL_PROFILE exported here.`);
        }
      } else if (cliProfile && cliProfile !== serverProfile) {
        warn(`tool-profile mismatch: server='${serverProfile}' but this CLI's CORTEX_TOOL_PROFILE='${cliProfile}' — stamping the SERVER's profile (it executed the runs).`);
      }
      // Align this process's env with the resolved truth so the legacy env
      // fallback inside ModelRouterMatrix.record() can never contradict the
      // explicit stamp (e.g. server=full but CLI env=lean).
      if (toolProfile) process.env.CORTEX_TOOL_PROFILE = toolProfile;
    }

    if (!options.json) {
      console.log();
      console.log(theme.colors.muted(` Benching ${tasks.length} task(s) × ${options.runs ?? 2} run(s) via ${source} [${split}]  tag=${options.experimentTag}`));
    }

    const summary = await runBench(tasks, runner, matrix, {
      experimentTag: options.experimentTag!,
      runs: options.runs ? Number(options.runs) : undefined,
      split,
      modelId: model,
      benchmarkSource: options.benchmarkSource,
      harnessRef: options.harnessRef,
      temperature: options.temperature !== undefined && Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : undefined,
      strategy: options.strategy,
      toolProfile,
      backlog: options.seedBacklog === false ? undefined : new ResearchBacklog(projectRoot),
      discoveredRound: options.experimentTag,
      discoveredRef: options.harnessRef,
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
    if (summary.seededDeficiencies > 0) {
      console.log(theme.colors.muted(` ${summary.seededDeficiencies} deficiency(ies) seeded → ${projectRoot}/.cortex/research-backlog.jsonl  (ResearchBacklog list / next)`));
    }
    console.log(theme.colors.muted(` Next: cortex autoresearch evaluate --experiment-tag ${options.experimentTag} --base <ref> --candidate <ref> --branch <wt>`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
