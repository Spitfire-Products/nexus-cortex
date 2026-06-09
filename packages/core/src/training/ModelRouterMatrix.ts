/**
 * ModelRouterMatrix — append-only JSONL benchmark store and model router.
 *
 * Ingests scored benchmark runs and produces composite scores balancing
 * correctness, efficiency, speed, and cost. Consumers call `recommend()`
 * for the best model for a given task type from accumulated empirical data.
 *
 * Persistence: `<projectRoot>/.cortex/router-matrix.jsonl`
 * Compaction: when file exceeds byte cap, raw records are aggregated into
 * weighted summary records (one per model+taskType). Summaries carry
 * `_summary: true` and `_sampleCount` so new observations don't dilute
 * historical knowledge. Falls back to simple rename if compaction fails.
 *
 * Assimilated from 6 model-generated implementations (2026-05-20 benchmark):
 *   - DeepSeek V4 Flash: JSONL rotation, field validation, configurable weights
 *   - Haiku 4.5: logistic/exponential scoring curves for speed/cost
 *   - Gemini 3 Flash: clean async read, production-ready structure
 *   - Grok-4-1-fast: per-task cold-start defaults, cache invalidation
 *   - Grok-code-fast: sync write for crash-safety
 *   - Gemini 2.5 Flash: model cost lookup table concept (fixed to use IDs)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { thompsonSelect, type ThompsonOptions } from './ThompsonRouter.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BenchmarkRecord {
  modelId: string;
  taskType: string;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  pass: boolean;
  qualitativeScore: number;
  timestamp?: string;
  costCents?: number;
  // --- Phase 1 provenance: turns the 2-axis (task × model) store into the
  // 3-axis (task × model × harness-version) ground truth that also drives the
  // auto-research keep/discard loop. All optional + back-compatible. ---
  /** git commit the running harness was built from (auto-stamped). Enables
   *  per-harness-version comparison, not just per-model. */
  harnessRef?: string;
  /** stable hash of the exact task+verifier — makes cross-version comparisons
   *  apples-to-apples (autoresearch "fixed eval" discipline). */
  taskFingerprint?: string;
  /** the worktree experiment round this record belongs to (from CORTEX_EXPERIMENT_TAG). */
  experimentTag?: string;
  /** OVERFITTING GUARD: 'holdout' records are reserved for final validation and
   *  must NOT be used to make keep/discard decisions — only to confirm a fix
   *  generalizes. Defaults to 'train'. Set holdout via CORTEX_BENCH_HOLDOUT=true. */
  split?: 'train' | 'holdout';
  /** Which benchmark produced this record. Keeps the pipeline source-agnostic so
   *  EXTERNAL official benchmarks (swebench, aider-polyglot, terminal-bench, …)
   *  feed the SAME matrix + backlog as the internal cortex-bench tasks. Defaults
   *  to 'cortex-bench'. An external runner records under its own source + the
   *  instance id as taskFingerprint, and pass/qualitativeScore from its grader. */
  benchmarkSource?: string;
}

export interface ModelScore {
  modelId: string;
  taskType: string;
  compositeScore: number;
  components: {
    correctness: number;
    efficiency: number;
    speed: number;
    cost: number;
  };
  sampleCount: number;
  avgPassRate: number;
  avgQualitativeScore: number;
  avgToolCalls: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgLatencyMs: number;
  avgCostCents: number;
}

export interface CostEfficiencyProfile {
  modelId: string;
  totalRuns: number;
  meanCompositeScore: number;
  meanCostCents: number;
  scorePerDollar: number;
  taskTypeCoverage: number;
  strongTasks: string[];
  weakTasks: string[];
  perTaskType: Record<string, {
    runs: number;
    compositeScore: number;
    avgCostCents: number;
  }>;
}

export type ScoringMatrix = Record<string, Record<string, ModelScore>>;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface StoredRecord extends BenchmarkRecord {
  _ts: number;
  _summary?: true;
  _sampleCount?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_MATRIX_MAX_BYTES = 2 * 1024 * 1024;

const STORE_RELATIVE_PATH = path.join('.cortex', 'router-matrix.jsonl');

export const DEFAULT_COMPOSITE_WEIGHTS = {
  correctness: 0.40,
  efficiency: 0.25,
  speed: 0.20,
  cost: 0.15,
} as const;

// Per-million-token costs in cents by model ID prefix.
// Override with explicit `costCents` on BenchmarkRecord for precision.
const MODEL_COST_TABLE: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'deepseek':      { inputPerMillion: 27,   outputPerMillion: 110  },
  'grok':          { inputPerMillion: 300,  outputPerMillion: 1500 },
  'claude-haiku':  { inputPerMillion: 80,   outputPerMillion: 400  },
  'claude-sonnet': { inputPerMillion: 300,  outputPerMillion: 1500 },
  'claude-opus':   { inputPerMillion: 1500, outputPerMillion: 7500 },
  'gemini':        { inputPerMillion: 15,   outputPerMillion: 60   },
  'gpt-4o':        { inputPerMillion: 250,  outputPerMillion: 1000 },
};

const DEFAULT_COST_RATES = { inputPerMillion: 300, outputPerMillion: 1500 };

// ---------------------------------------------------------------------------
// Cold-start defaults — per-task-type model rankings from benchmarks
// ---------------------------------------------------------------------------

const COLD_START_DEFAULTS: Record<string, ReadonlyArray<{
  modelId: string;
  compositeScore: number;
}>> = {
  T1: [
    { modelId: 'grok-4-1-fast-reasoning', compositeScore: 92 },
    { modelId: 'deepseek-v4-flash',       compositeScore: 90 },
    { modelId: 'grok-code-fast-1',        compositeScore: 88 },
    { modelId: 'claude-haiku-4-5',        compositeScore: 85 },
    { modelId: 'gemini-3-flash-preview',  compositeScore: 82 },
  ],
  T2: [
    { modelId: 'claude-sonnet-4-20250514', compositeScore: 94 },
    { modelId: 'deepseek-v4-flash',        compositeScore: 87 },
    { modelId: 'grok-4-1-fast-reasoning',  compositeScore: 83 },
    { modelId: 'grok-code-fast-1',         compositeScore: 80 },
    { modelId: 'claude-haiku-4-5',         compositeScore: 74 },
  ],
  T3: [
    { modelId: 'grok-4-1-fast-reasoning', compositeScore: 91 },
    { modelId: 'deepseek-v4-flash',       compositeScore: 88 },
    { modelId: 'grok-code-fast-1',        compositeScore: 84 },
    { modelId: 'claude-haiku-4-5',        compositeScore: 81 },
    { modelId: 'gemini-3-flash-preview',  compositeScore: 76 },
  ],
  T4: [
    { modelId: 'claude-sonnet-4-20250514', compositeScore: 95 },
    { modelId: 'deepseek-v4-flash',        compositeScore: 88 },
    { modelId: 'grok-4-1-fast-reasoning',  compositeScore: 84 },
    { modelId: 'claude-haiku-4-5',         compositeScore: 79 },
    { modelId: 'grok-code-fast-1',         compositeScore: 72 },
  ],
  T5: [
    { modelId: 'deepseek-v4-flash',        compositeScore: 93 },
    { modelId: 'claude-haiku-4-5',         compositeScore: 89 },
    { modelId: 'gemini-3-flash-preview',   compositeScore: 87 },
    { modelId: 'grok-4-1-fast-reasoning',  compositeScore: 83 },
    { modelId: 'grok-code-fast-1',         compositeScore: 72 },
  ],
};

// ---------------------------------------------------------------------------
// Scoring functions (from Haiku 4.5 — logistic/exponential curves)
// ---------------------------------------------------------------------------

/** Correctness: pass rate × qualitative. Zero pass = zero correctness. */
function computeCorrectness(avgPassRate: number, avgQualitative: number): number {
  return avgPassRate * avgQualitative;
}

/** Efficiency: inverse of tool calls + token volume (0-100). */
function computeEfficiency(avgToolCalls: number, avgInputTokens: number, avgOutputTokens: number): number {
  const toolScore = Math.max(0, 100 - avgToolCalls * 5);
  const tokenScore = Math.max(0, 100 - (avgInputTokens + avgOutputTokens) / 2000);
  return toolScore * 0.4 + tokenScore * 0.6;
}

/** Speed: logistic curve with adaptive midpoint.
 *  API-scale (<10s): midpoint 1000ms, spread 500ms.
 *  Harness-scale (>10s): midpoint 120s, spread 60s.
 *  Handles both raw API latency and end-to-end tool-loop benchmarks. */
function computeSpeed(avgLatencyMs: number): number {
  const midpoint = avgLatencyMs > 10_000 ? 120_000 : 1_000;
  const spread = avgLatencyMs > 10_000 ? 60_000 : 500;
  const score = 100 / (1 + Math.exp((avgLatencyMs - midpoint) / spread));
  return Math.max(0, Math.min(100, score));
}

/** Cost: exponential decay — $0 = 100, $0.02 = ~45, $0.10 = ~6. */
function computeCost(avgCostCents: number): number {
  const dollars = avgCostCents / 100;
  const score = 100 * Math.exp(-5 * dollars);
  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Defensive: a non-string modelId (e.g. a model object leaking through a
  // recorder) must not crash the matrix — fall back to default rates.
  const id = typeof modelId === 'string' ? modelId : '';
  const prefix = Object.keys(MODEL_COST_TABLE).find(p => id.startsWith(p));
  const rates = prefix ? MODEL_COST_TABLE[prefix]! : DEFAULT_COST_RATES;
  const inputCents = (inputTokens / 1_000_000) * rates.inputPerMillion;
  const outputCents = (outputTokens / 1_000_000) * rates.outputPerMillion;
  return inputCents + outputCents;
}

export function resolveMaxMatrixBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CORTEX_MATRIX_MAX_BYTES?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_MATRIX_MAX_BYTES;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MATRIX_MAX_BYTES;
}

// ---------------------------------------------------------------------------
// ModelRouterMatrix
// ---------------------------------------------------------------------------

export class ModelRouterMatrix {
  private readonly storePath: string;
  private readonly projectRoot: string;
  private readonly maxBytes: number;
  private readonly weights: typeof DEFAULT_COMPOSITE_WEIGHTS;
  private scoreCache: Map<string, ModelScore[]> = new Map();
  private _harnessRef?: string;

  /** Stable 16-char fingerprint of a task's exact prompt (+ optional verifier).
   *  Use it so cross-harness-version comparisons measure the SAME task. */
  static fingerprintTask(prompt: string, verifier?: string): string {
    return crypto.createHash('sha256').update(`${prompt} ${verifier ?? ''}`, 'utf8').digest('hex').slice(0, 16);
  }

  /** git commit the running process was built from. Cached for the process
   *  lifetime (a rebuild/restart picks up the new ref). 'unknown' off-git. */
  private currentHarnessRef(): string {
    if (this._harnessRef !== undefined) return this._harnessRef;
    try {
      this._harnessRef = execFileSync('git', ['-C', this.projectRoot, 'rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || 'unknown';
    } catch { this._harnessRef = 'unknown'; }
    return this._harnessRef;
  }

  constructor(
    projectRoot: string,
    maxBytes?: number,
    weights?: Partial<typeof DEFAULT_COMPOSITE_WEIGHTS>,
  ) {
    this.projectRoot = projectRoot;
    this.storePath = path.join(projectRoot, STORE_RELATIVE_PATH);
    this.maxBytes = maxBytes ?? resolveMaxMatrixBytes();
    this.weights = {
      correctness: weights?.correctness ?? DEFAULT_COMPOSITE_WEIGHTS.correctness,
      efficiency: weights?.efficiency ?? DEFAULT_COMPOSITE_WEIGHTS.efficiency,
      speed: weights?.speed ?? DEFAULT_COMPOSITE_WEIGHTS.speed,
      cost: weights?.cost ?? DEFAULT_COMPOSITE_WEIGHTS.cost,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  record(entry: BenchmarkRecord): void {
    const record: StoredRecord = {
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      costCents: entry.costCents ?? estimateCost(entry.modelId, entry.inputTokens, entry.outputTokens),
      // Phase 1 provenance — auto-stamp the harness version + experiment tag + split
      harnessRef: entry.harnessRef ?? this.currentHarnessRef(),
      experimentTag: entry.experimentTag ?? process.env.CORTEX_EXPERIMENT_TAG,
      split: entry.split ?? (process.env.CORTEX_BENCH_HOLDOUT === 'true' ? 'holdout' : 'train'),
      benchmarkSource: entry.benchmarkSource ?? process.env.CORTEX_BENCH_SOURCE ?? 'cortex-bench',
      _ts: Date.now(),
    };
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    this.rotateIfNeeded();
    fs.appendFileSync(this.storePath, JSON.stringify(record) + '\n', 'utf-8');
    this.scoreCache.clear();
  }

  getScores(taskType: string): ModelScore[] {
    const cached = this.scoreCache.get(taskType);
    if (cached) return cached;

    const records = this.loadRecords().filter(r => r.taskType === taskType);
    if (records.length === 0) {
      const fallback = this.coldStartScores(taskType);
      this.scoreCache.set(taskType, fallback);
      return fallback;
    }
    const scores = this.aggregateScores(records);
    this.scoreCache.set(taskType, scores);
    return scores;
  }

  recommend(taskType: string): string {
    const scores = this.getScores(taskType);
    // DeepSeek is the safe ultimate fallback: capable + cheap, and it honors the
    // no-xAI cost constraint (a grok fallback here would auto-route to an
    // expensive provider for any unseen task type).
    return scores.length > 0 ? scores[0]!.modelId : 'deepseek-v4-flash';
  }

  /**
   * Raw benchmark records (with provenance), optionally filtered. This is the
   * query surface the auto-research decision layer (VersionComparison +
   * AutoResearchStats) reads to compare harness versions task-by-task.
   *
   * Compacted `_summary` aggregates are EXCLUDED by default: version comparison
   * and the Monte-Carlo gate need per-run granularity (bootstrap resamples
   * individual runs), which summaries don't preserve. Pass includeSummaries to
   * override. `split` defaults to no filter — callers enforcing the overfitting
   * guard MUST pass split:'train' for keep/discard and split:'holdout' for
   * verification.
   */
  getRecords(filter: {
    taskFingerprint?: string;
    harnessRef?: string;
    split?: 'train' | 'holdout';
    modelId?: string;
    taskType?: string;
    benchmarkSource?: string;
    includeSummaries?: boolean;
  } = {}): BenchmarkRecord[] {
    const out: BenchmarkRecord[] = [];
    for (const r of this.loadRecords()) {
      if (!filter.includeSummaries && r._summary) continue;
      if (filter.taskFingerprint !== undefined && r.taskFingerprint !== filter.taskFingerprint) continue;
      if (filter.harnessRef !== undefined && r.harnessRef !== filter.harnessRef) continue;
      if (filter.split !== undefined && (r.split ?? 'train') !== filter.split) continue;
      if (filter.modelId !== undefined && r.modelId !== filter.modelId) continue;
      if (filter.taskType !== undefined && r.taskType !== filter.taskType) continue;
      if (filter.benchmarkSource !== undefined && (r.benchmarkSource ?? 'cortex-bench') !== filter.benchmarkSource) continue;
      const { _ts, _summary, _sampleCount, ...rec } = r;
      void _ts; void _summary; void _sampleCount;
      out.push(rec);
    }
    return out;
  }

  /** Distinct taskFingerprints present at a given harness version (train split by
   *  default). Drives regressionScan's "every task the candidate ran" loop. */
  taskFingerprintsAt(harnessRef: string, split: 'train' | 'holdout' = 'train'): string[] {
    const seen = new Set<string>();
    for (const r of this.getRecords({ harnessRef, split })) {
      if (r.taskFingerprint) seen.add(r.taskFingerprint);
    }
    return [...seen];
  }

  /**
   * Trust-gated recommendation: returns the top model ONLY when the decision is
   * data-backed — i.e. the top score has >= minSamples real benchmark
   * observations. Cold-start defaults carry sampleCount 0, so they (and empty
   * task types) return null. This is the quality gate for auto-routing: route
   * only when the matrix has earned the decision, otherwise the caller inherits
   * a safe default. As MODEL_ROUTER_RECORD accumulates observations, more task
   * types cross the threshold and begin routing.
   */
  recommendTrusted(taskType: string, minSamples = 3): string | null {
    const top = this.getScores(taskType)[0];
    if (!top || top.sampleCount < minSamples) return null;
    return top.modelId;
  }

  /**
   * Thompson-sampling recommendation (explore/exploit). Draws one posterior
   * sample per model from the task's score distribution and returns the
   * sampled-argmax — so thinly-sampled models occasionally get a chance and the
   * matrix stops being self-confirming. OPT-IN only (MODEL_ROUTER_EXPLORATION);
   * greedy `recommend`/`recommendTrusted` are the defaults. `exclude` (from
   * MODEL_ROUTER_EXCLUDE) bans models that must never be auto-selected. Returns
   * null when no eligible model remains → caller inherits its safe default.
   */
  recommendThompson(taskType: string, opts: ThompsonOptions = {}): string | null {
    return thompsonSelect(this.getScores(taskType), opts);
  }

  getMatrix(): ScoringMatrix {
    const allRecords = this.loadRecords();
    const taskTypes = this.collectTaskTypes(allRecords);
    const matrix: ScoringMatrix = {};

    for (const tt of taskTypes) {
      const ttRecords = allRecords.filter(r => r.taskType === tt);
      const scores = ttRecords.length > 0
        ? this.aggregateScores(ttRecords)
        : this.coldStartScores(tt);

      const byModel: Record<string, ModelScore> = {};
      for (const s of scores) byModel[s.modelId] = s;
      matrix[tt] = byModel;
    }
    return matrix;
  }

  getCostEfficiency(modelId: string): CostEfficiencyProfile {
    const allRecords = this.loadRecords().filter(r => r.modelId === modelId);
    if (allRecords.length === 0) {
      return {
        modelId, totalRuns: 0, meanCompositeScore: 0, meanCostCents: 0,
        scorePerDollar: 0, taskTypeCoverage: 0, strongTasks: [], weakTasks: [],
        perTaskType: {},
      };
    }

    const byTask = this.groupBy(allRecords, r => r.taskType);
    const perTaskType: CostEfficiencyProfile['perTaskType'] = {};
    const strongTasks: string[] = [];
    const weakTasks: string[] = [];
    let totalComposite = 0;

    for (const [tt, recs] of Object.entries(byTask)) {
      const scores = this.aggregateScores(recs);
      const ms = scores.find(s => s.modelId === modelId);
      if (!ms) continue;
      perTaskType[tt] = { runs: recs.length, compositeScore: ms.compositeScore, avgCostCents: ms.avgCostCents };
      totalComposite += ms.compositeScore;
      if (ms.compositeScore >= 80) strongTasks.push(tt);
      if (ms.compositeScore < 60) weakTasks.push(tt);
    }

    const taskCount = Object.keys(perTaskType).length;
    const totalCost = allRecords.reduce((s, r) => s + (r.costCents ?? 0), 0);
    const meanCost = totalCost / allRecords.length;
    const meanComposite = taskCount > 0 ? totalComposite / taskCount : 0;

    return {
      modelId,
      totalRuns: allRecords.length,
      meanCompositeScore: round2(meanComposite),
      meanCostCents: round3(meanCost),
      scorePerDollar: meanCost > 0 ? round2((meanComposite / meanCost) * 100) : Infinity,
      taskTypeCoverage: taskCount,
      strongTasks,
      weakTasks,
      perTaskType,
    };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private rotateIfNeeded(): void {
    try {
      const { size } = fs.statSync(this.storePath);
      if (size <= this.maxBytes) return;
    } catch { return; /* ENOENT — nothing to rotate */ }

    // Compact: aggregate current records into per-model+taskType summaries,
    // then start fresh. Summaries carry _summary and _sampleCount so
    // aggregateScores can weight them proportionally against new raw records.
    try {
      const records = this.loadMainOnly();
      const summaries = this.compactToSummaries(records);
      const lines = summaries.map(s => JSON.stringify(s)).join('\n') + '\n';
      fs.writeFileSync(this.storePath, lines, 'utf-8');
    } catch { /* compaction failure — fall back to simple rename */
      try { fs.renameSync(this.storePath, this.storePath + '.1'); } catch { /* */ }
    }
  }

  private loadMainOnly(): StoredRecord[] {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf-8');
      const out: StoredRecord[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (isValidRecord(parsed)) out.push(parsed);
        } catch { /* skip malformed */ }
      }
      return out;
    } catch { return []; }
  }

  private compactToSummaries(records: StoredRecord[]): StoredRecord[] {
    const groups = this.groupBy(records, r => `${r.modelId}::${r.taskType}`);
    const summaries: StoredRecord[] = [];

    for (const recs of Object.values(groups)) {
      let weight = 0, sumPass = 0, sumQual = 0, sumTools = 0;
      let sumIn = 0, sumOut = 0, sumLat = 0, sumCost = 0;

      for (const r of recs) {
        const w = r._sampleCount ?? 1;
        weight += w;
        sumPass += (r.pass ? 1 : 0) * w;
        sumQual += r.qualitativeScore * w;
        sumTools += r.toolCallCount * w;
        sumIn += r.inputTokens * w;
        sumOut += r.outputTokens * w;
        sumLat += r.latencyMs * w;
        sumCost += (r.costCents ?? 0) * w;
      }

      summaries.push({
        modelId: recs[0]!.modelId,
        taskType: recs[0]!.taskType,
        toolCallCount: round2(sumTools / weight),
        inputTokens: Math.round(sumIn / weight),
        outputTokens: Math.round(sumOut / weight),
        latencyMs: Math.round(sumLat / weight),
        pass: (sumPass / weight) >= 0.5,
        qualitativeScore: round2(sumQual / weight),
        costCents: round3(sumCost / weight),
        timestamp: new Date().toISOString(),
        _ts: Date.now(),
        _summary: true,
        _sampleCount: weight,
      });
    }

    return summaries;
  }

  private loadRecords(): StoredRecord[] {
    // Read main file + legacy .1 (from pre-compaction rotation or fallback)
    const readMaybe = (p: string): string => {
      try { return fs.readFileSync(p, 'utf-8'); }
      catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw err;
      }
    };

    const rotated = readMaybe(this.storePath + '.1');
    const main = readMaybe(this.storePath);
    const raw = rotated
      + (rotated.length > 0 && !rotated.endsWith('\n') ? '\n' : '')
      + main;
    if (!raw) return [];

    const out: StoredRecord[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (isValidRecord(parsed)) out.push(parsed);
      } catch { /* skip malformed lines */ }
    }
    return out;
  }

  private aggregateScores(records: StoredRecord[]): ModelScore[] {
    const groups = this.groupBy(records, r => r.modelId);
    const results: ModelScore[] = [];

    for (const [modelId, recs] of Object.entries(groups)) {
      // Weight summary records by their _sampleCount so compacted history
      // isn't diluted by a handful of new observations.
      let totalWeight = 0;
      let sumPass = 0, sumQual = 0, sumTools = 0, sumIn = 0, sumOut = 0, sumLat = 0, sumCost = 0;

      for (const r of recs) {
        const w = r._sampleCount ?? 1;
        totalWeight += w;
        sumPass += (r.pass ? 1 : 0) * w;
        sumQual += r.qualitativeScore * w;
        sumTools += r.toolCallCount * w;
        sumIn += r.inputTokens * w;
        sumOut += r.outputTokens * w;
        sumLat += r.latencyMs * w;
        sumCost += (r.costCents ?? estimateCost(r.modelId, r.inputTokens, r.outputTokens)) * w;
      }

      const n = totalWeight;
      const avgPass = sumPass / n;
      const avgQual = sumQual / n;
      const avgTools = sumTools / n;
      const avgIn = sumIn / n;
      const avgOut = sumOut / n;
      const avgLat = sumLat / n;
      const avgCost = sumCost / n;

      const correctness = computeCorrectness(avgPass, avgQual);
      const efficiency = computeEfficiency(avgTools, avgIn, avgOut);
      const speed = computeSpeed(avgLat);
      const cost = computeCost(avgCost);

      const compositeScore =
        this.weights.correctness * correctness +
        this.weights.efficiency * efficiency +
        this.weights.speed * speed +
        this.weights.cost * cost;

      results.push({
        modelId,
        taskType: recs[0]!.taskType,
        compositeScore: round2(compositeScore),
        components: {
          correctness: round2(correctness),
          efficiency: round2(efficiency),
          speed: round2(speed),
          cost: round2(cost),
        },
        sampleCount: Math.round(totalWeight),
        avgPassRate: round3(avgPass),
        avgQualitativeScore: round2(avgQual),
        avgToolCalls: round2(avgTools),
        avgInputTokens: Math.round(avgIn),
        avgOutputTokens: Math.round(avgOut),
        avgLatencyMs: Math.round(avgLat),
        avgCostCents: round3(avgCost),
      });
    }

    results.sort((a, b) => b.compositeScore - a.compositeScore);
    return results;
  }

  private collectTaskTypes(records: StoredRecord[]): string[] {
    const types: Record<string, true> = {};
    for (const key of Object.keys(COLD_START_DEFAULTS)) types[key] = true;
    for (const r of records) types[r.taskType] = true;
    return Object.keys(types).sort();
  }

  private coldStartScores(taskType: string): ModelScore[] {
    const defaults = COLD_START_DEFAULTS[taskType];
    if (!defaults) return [];
    return defaults.map(d => ({
      modelId: d.modelId,
      taskType,
      compositeScore: d.compositeScore,
      components: { correctness: d.compositeScore, efficiency: 50, speed: 50, cost: 50 },
      sampleCount: 0,
      avgPassRate: 0,
      avgQualitativeScore: 0,
      avgToolCalls: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgLatencyMs: 0,
      avgCostCents: 0,
    }));
  }

  private groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
    const groups: Record<string, T[]> = {};
    for (const item of items) {
      const k = key(item);
      const list = groups[k];
      if (list) list.push(item);
      else groups[k] = [item];
    }
    return groups;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidRecord(parsed: unknown): parsed is StoredRecord {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const r = parsed as Record<string, unknown>;
  return (
    typeof r.modelId === 'string' &&
    typeof r.taskType === 'string' &&
    typeof r.pass === 'boolean' &&
    typeof r.qualitativeScore === 'number'
  );
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
