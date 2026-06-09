/**
 * BenchRunner — the missing GRADER that produces REAL scored matrix records.
 *
 * The orchestrator's auto-record (MODEL_ROUTER_RECORD) writes a liveness STUB
 * (`qualitativeScore = hasText ? 75 : 0`) — fine for "is the model alive", useless
 * for "did the candidate harness get better". The auto-research decision layer
 * consumes `qualitativeScore` as the per-run signal, so without a real grader
 * every base/candidate comparison is a flat tie → the gate always says discard.
 *
 * This module runs a TASK SET through the harness and grades each run with a
 * deterministic (or LLM-judge) verifier, writing the REAL pass/qualitativeScore
 * to `router-matrix.jsonl` under a given experimentTag/split. The CLI
 * (`cortex autoresearch bench`) wires a concrete HarnessRunner; here everything
 * is pure + injectable so it unit-tests with no network.
 *
 * FLOW: orchestrator (nexus side) runs this in the base worktree (→ records under
 * harnessRef=base) and the candidate worktree (→ harnessRef=candidate), then calls
 * `cortex autoresearch evaluate --base … --candidate …` which compares them.
 * One bench run = one harness build; the base/candidate axis is the git ref the
 * record is auto-stamped with (override via opts.harnessRef for single-box tests).
 */

import { ModelRouterMatrix } from './ModelRouterMatrix.js';
import { classifyTask } from './TaskClassifier.js';

// ---------------------------------------------------------------------------
// Task set + verifier schema (the JSON format a task file uses)
// ---------------------------------------------------------------------------

export type Verifier =
  /** output, normalized, must equal `expected` exactly. */
  | { type: 'exact'; expected: string; normalize?: boolean }
  /** `pattern` (RegExp) must match somewhere in the output. */
  | { type: 'regex'; pattern: string; flags?: string }
  /** every string in `all` must appear — PARTIAL CREDIT: score = found/total×100.
   *  This is the workhorse: graded continuous scores (not just pass/fail) give the
   *  bootstrap/permutation gate real signal to separate base from candidate. */
  | { type: 'contains'; all: string[]; caseInsensitive?: boolean }
  /** delegated to an injected judge fn (e.g. the deepseek helper). */
  | { type: 'llm-judge'; rubric: string };

export interface TaskSpec {
  id: string;
  prompt: string;
  verifier: Verifier;
  /** T1–T5; if omitted, classifyTask(prompt) decides. */
  taskType?: string;
}

/** Optional LLM judge — injected so core stays network-free. */
export type JudgeFn = (output: string, rubric: string) => Promise<{ pass: boolean; qualitativeScore: number }>;

export interface GradeResult {
  pass: boolean;
  /** 0–100. Continuous where possible (partial credit) so the gate can separate arms. */
  qualitativeScore: number;
  detail?: string;
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Grade one model output against a verifier. Pure for the deterministic types;
 * `contains` gives partial credit. `llm-judge` requires an injected judge.
 */
export async function gradeRun(output: string, verifier: Verifier, judge?: JudgeFn): Promise<GradeResult> {
  switch (verifier.type) {
    case 'exact': {
      const a = verifier.normalize ? normalizeWs(output) : output.trim();
      const b = verifier.normalize ? normalizeWs(verifier.expected) : verifier.expected.trim();
      const pass = a === b;
      return { pass, qualitativeScore: pass ? 100 : 0 };
    }
    case 'regex': {
      const re = new RegExp(verifier.pattern, verifier.flags);
      const pass = re.test(output);
      return { pass, qualitativeScore: pass ? 100 : 0 };
    }
    case 'contains': {
      const hay = verifier.caseInsensitive ? output.toLowerCase() : output;
      const needles = verifier.all.map(n => (verifier.caseInsensitive ? n.toLowerCase() : n));
      const found = needles.filter(n => hay.includes(n)).length;
      const total = needles.length || 1;
      const qualitativeScore = Math.round((found / total) * 100);
      return { pass: found === needles.length, qualitativeScore, detail: `${found}/${needles.length} matched` };
    }
    case 'llm-judge': {
      if (!judge) throw new Error("gradeRun: verifier type 'llm-judge' requires an injected JudgeFn");
      return judge(output, verifier.rubric);
    }
    default: {
      const _exhaustive: never = verifier;
      throw new Error(`gradeRun: unknown verifier ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Harness runner boundary (injectable — real adapter lives in the CLI)
// ---------------------------------------------------------------------------

export interface HarnessRunResult {
  text: string;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  latencyMs: number;
}

export interface HarnessRunner {
  run(prompt: string, opts?: { model?: string }): Promise<HarnessRunResult>;
}

// ---------------------------------------------------------------------------
// runBench — execute + grade + record
// ---------------------------------------------------------------------------

export interface RunBenchOptions {
  experimentTag: string;
  runs?: number;            // per task (default 2 — n>=2 for significance)
  split?: 'train' | 'holdout';
  modelId?: string;
  benchmarkSource?: string;
  /** override the auto-stamped git SHA (single-box base/candidate simulation). */
  harnessRef?: string;
  judge?: JudgeFn;
  /** progress callback (one per graded run). */
  onRun?: (info: { taskId: string; run: number; pass: boolean; qualitativeScore: number }) => void;
}

export interface BenchTaskSummary {
  taskId: string;
  taskFingerprint: string;
  taskType: string;
  runs: number;
  passRate: number;
  meanScore: number;
}

export interface BenchSummary {
  experimentTag: string;
  split: 'train' | 'holdout';
  harnessRef?: string;
  totalRuns: number;
  tasks: BenchTaskSummary[];
}

/**
 * Run each task `runs` times through `runner`, grade each output, and write a
 * REAL scored BenchmarkRecord to the matrix (harnessRef auto-stamped unless
 * overridden; taskFingerprint = hash of prompt+verifier so it's the stable
 * comparability key the gate joins on).
 */
export async function runBench(
  tasks: TaskSpec[],
  runner: HarnessRunner,
  matrix: ModelRouterMatrix,
  opts: RunBenchOptions,
): Promise<BenchSummary> {
  const runs = opts.runs ?? 2;
  const split = opts.split ?? 'train';
  const taskSummaries: BenchTaskSummary[] = [];
  let totalRuns = 0;

  for (const task of tasks) {
    const taskType = task.taskType ?? classifyTask(task.prompt).taskType;
    const taskFingerprint = ModelRouterMatrix.fingerprintTask(task.prompt, JSON.stringify(task.verifier));
    let passes = 0;
    let scoreSum = 0;

    for (let i = 0; i < runs; i++) {
      const res = await runner.run(task.prompt, { model: opts.modelId });
      const grade = await gradeRun(res.text, task.verifier, opts.judge);
      passes += grade.pass ? 1 : 0;
      scoreSum += grade.qualitativeScore;
      totalRuns++;

      matrix.record({
        modelId: res.modelId ?? opts.modelId ?? 'unknown',
        taskType,
        toolCallCount: res.toolCallCount,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        latencyMs: res.latencyMs,
        pass: grade.pass,
        qualitativeScore: grade.qualitativeScore,
        taskFingerprint,
        experimentTag: opts.experimentTag,
        split,
        benchmarkSource: opts.benchmarkSource,
        ...(opts.harnessRef ? { harnessRef: opts.harnessRef } : {}),
      });

      opts.onRun?.({ taskId: task.id, run: i + 1, pass: grade.pass, qualitativeScore: grade.qualitativeScore });
    }

    taskSummaries.push({
      taskId: task.id,
      taskFingerprint,
      taskType,
      runs,
      passRate: Math.round((passes / runs) * 1000) / 1000,
      meanScore: Math.round((scoreSum / runs) * 100) / 100,
    });
  }

  return {
    experimentTag: opts.experimentTag,
    split,
    harnessRef: opts.harnessRef,
    totalRuns,
    tasks: taskSummaries,
  };
}

/** Validate a parsed task-set JSON value, throwing on malformed entries. */
export function parseTaskSet(raw: unknown, source = '<task-set>'): TaskSpec[] {
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((t, i) => {
    if (!t || typeof t !== 'object') throw new Error(`${source}[${i}]: not an object`);
    const o = t as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) throw new Error(`${source}[${i}]: missing 'id'`);
    if (typeof o.prompt !== 'string' || !o.prompt) throw new Error(`${source}[${i}] (${o.id}): missing 'prompt'`);
    if (!o.verifier || typeof o.verifier !== 'object') throw new Error(`${source}[${i}] (${o.id}): missing 'verifier'`);
    const v = o.verifier as Record<string, unknown>;
    const validTypes = ['exact', 'regex', 'contains', 'llm-judge'];
    if (typeof v.type !== 'string' || !validTypes.includes(v.type)) {
      throw new Error(`${source}[${i}] (${o.id}): verifier.type must be one of ${validTypes.join('|')}`);
    }
    return { id: o.id, prompt: o.prompt, verifier: o.verifier as Verifier, taskType: o.taskType as string | undefined };
  });
}
