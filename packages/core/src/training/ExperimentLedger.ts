/**
 * ExperimentLedger — the keep/discard decision record for auto-research.
 *
 * One auto-research *unit* = a candidate harness version (a worktree branch) tested
 * against a base version across a set of fixed-eval tasks. This ledger records the
 * decision: did the candidate beat the base by a statistically real margin, or was
 * the apparent improvement noise? That decision — `keep` | `discard` | `pending` —
 * is the API the swarm (Layer 2) consumes before any autonomous merge.
 *
 * OVERFITTING GUARD (load-bearing): the decision is made from `split:'train'`
 * benchmark records only; `split:'holdout'` records confirm generalization and are
 * NEVER the basis for keep/discard. The statistical fields (pValue/ciLow/ciHigh/
 * fwerAdjusted) come from the Monte-Carlo gate (AutoResearchStats) — a raw `delta>0`
 * must NEVER set decision='keep'. A recursive loop fed by raw deltas overfits to
 * noise; that is the entire failure mode this layer exists to prevent.
 *
 * Store: append-only JSONL at `.cortex/experiments.jsonl`. Latest snapshot per
 * `experimentTag` wins; never rewritten in place (concurrent-safe for two agents
 * sharing the tree).
 *
 * --- STDB PORTABILITY (the Layer-3 integration contract) ---
 * This schema is deliberately shaped to map 1:1 onto SpacetimeDB tables. STDB
 * columns must be flat scalars (nested arrays become child tables), so:
 *   - `ExperimentRecord` (minus `results`)  -> table `experiment` (flat header)
 *   - `ExperimentTaskResult[]` (`results`)   -> table `experiment_task_result` (child)
 * The two are joined by `experimentTag`. Locally we embed `results[]` in the JSON
 * line for convenience; the nexus side splits it into the child table on ingest.
 * Keep these field lists in sync with `cortex-autoresearch-swarm-port.md`.
 */

import * as fs from 'fs';
import * as path from 'path';

export type ExperimentDecision = 'keep' | 'discard' | 'pending';

/**
 * Per-task base-vs-candidate comparison. One row per fixed-eval task in the
 * experiment. STDB child table `experiment_task_result` (joined by experimentTag).
 */
export interface ExperimentTaskResult {
  /** join key back to the parent experiment (denormalized for the STDB child table). */
  experimentTag: string;
  /** the comparability key — same task across base and candidate harness versions. */
  taskFingerprint: string;
  /** mean composite/qualitative score on the BASE harness version (split='train'). */
  baseScore: number;
  /** mean composite/qualitative score on the CANDIDATE harness version (split='train'). */
  candScore: number;
  /** candScore - baseScore. Convenience; recomputed on write so it never drifts. */
  delta: number;
  /** number of base-version runs aggregated into baseScore (n>=2 for significance). */
  baseN: number;
  /** number of candidate-version runs aggregated into candScore. */
  candN: number;
}

/**
 * The experiment header — one keep/discard decision. STDB table `experiment`.
 * Everything here is a flat scalar EXCEPT `results` (which STDB splits out).
 */
export interface ExperimentRecord {
  /** = swarm-member id. Stable key; latest snapshot per tag wins. */
  experimentTag: string;
  /** harness git ref the candidate is measured against (the control). */
  baseRef: string;
  /** harness git ref under test (the candidate / worktree HEAD). */
  candidateRef: string;
  /** worktree branch name the experiment runs on. */
  branch: string;
  /** the gate's verdict. 'pending' until the Monte-Carlo gate has enough runs. */
  decision: ExperimentDecision;
  /** commit the candidate was merged at, once kept + verified on held-out. */
  mergedCommit?: string;
  /** human/agent-readable rationale (which deficiency, why kept/discarded). */
  reason?: string;
  /** total benchmark runs feeding this decision (sum across tasks/arms). */
  nRuns: number;
  /** permutation-test p-value from the Monte-Carlo gate (lower = more real). */
  pValue?: number;
  /** bootstrap CI lower bound on the aggregate delta. */
  ciLow?: number;
  /** bootstrap CI upper bound on the aggregate delta. */
  ciHigh?: number;
  /** true once the p-value/CI has been corrected for the swarm's family-wise
   *  error rate (N parallel experiments). A 'keep' is only trustworthy when this
   *  is true — it's the multiple-comparisons guard at swarm scale. */
  fwerAdjusted?: boolean;
  /** deficiency id (ResearchBacklog) this experiment addresses, if any. */
  deficiencyId?: string;
  /** which benchmark lens produced the underlying records (cortex-bench|swebench|…). */
  benchmarkSource?: string;
  /** per-task comparisons. STDB: this array -> `experiment_task_result` child rows. */
  results: ExperimentTaskResult[];
  createdAt: string;
  updatedAt: string;
}

export interface NewExperiment {
  experimentTag: string;
  baseRef: string;
  candidateRef: string;
  branch: string;
  deficiencyId?: string;
  benchmarkSource?: string;
  reason?: string;
  results?: ExperimentTaskResult[];
}

/** Fields the Monte-Carlo gate writes back onto an experiment when it decides. */
export interface DecisionUpdate {
  decision: ExperimentDecision;
  pValue?: number;
  ciLow?: number;
  ciHigh?: number;
  fwerAdjusted?: boolean;
  nRuns?: number;
  reason?: string;
  mergedCommit?: string;
}

const STORE_RELATIVE_PATH = path.join('.cortex', 'experiments.jsonl');

function normalizeResults(experimentTag: string, results: ExperimentTaskResult[] = []): ExperimentTaskResult[] {
  return results.map(r => ({
    experimentTag,
    taskFingerprint: r.taskFingerprint,
    baseScore: r.baseScore,
    candScore: r.candScore,
    delta: Math.round((r.candScore - r.baseScore) * 1000) / 1000,
    baseN: r.baseN,
    candN: r.candN,
  }));
}

export class ExperimentLedger {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = path.join(projectRoot, STORE_RELATIVE_PATH);
  }

  private append(rec: ExperimentRecord): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.appendFileSync(this.storePath, JSON.stringify(rec) + '\n', 'utf8');
  }

  /** Current state = latest snapshot per experimentTag (append-only; last write wins). */
  list(opts: { decision?: ExperimentDecision | ExperimentDecision[] } = {}): ExperimentRecord[] {
    let raw = '';
    try { raw = fs.readFileSync(this.storePath, 'utf8'); } catch { return []; }
    const byTag = new Map<string, ExperimentRecord>();
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as ExperimentRecord;
        if (r && typeof r.experimentTag === 'string') byTag.set(r.experimentTag, r);
      } catch { /* skip corrupt line */ }
    }
    let out = [...byTag.values()];
    if (opts.decision) {
      const want = Array.isArray(opts.decision) ? opts.decision : [opts.decision];
      out = out.filter(r => want.includes(r.decision));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(experimentTag: string): ExperimentRecord | undefined {
    return this.list().find(r => r.experimentTag === experimentTag);
  }

  /** Open a new experiment (or re-snapshot an existing tag). Starts 'pending' —
   *  a decision is NEVER set at creation; only the Monte-Carlo gate decides. */
  open(e: NewExperiment): ExperimentRecord {
    const existing = this.get(e.experimentTag);
    const now = new Date().toISOString();
    const results = normalizeResults(e.experimentTag, e.results ?? existing?.results ?? []);
    const rec: ExperimentRecord = {
      experimentTag: e.experimentTag,
      baseRef: e.baseRef,
      candidateRef: e.candidateRef,
      branch: e.branch,
      decision: existing?.decision ?? 'pending',
      mergedCommit: existing?.mergedCommit,
      reason: e.reason ?? existing?.reason,
      nRuns: existing?.nRuns ?? results.reduce((s, r) => s + r.baseN + r.candN, 0),
      pValue: existing?.pValue,
      ciLow: existing?.ciLow,
      ciHigh: existing?.ciHigh,
      fwerAdjusted: existing?.fwerAdjusted,
      deficiencyId: e.deficiencyId ?? existing?.deficiencyId,
      benchmarkSource: e.benchmarkSource ?? existing?.benchmarkSource,
      results,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.append(rec);
    return rec;
  }

  /** Replace the per-task comparison set (e.g. after compareVersions runs). */
  setResults(experimentTag: string, results: ExperimentTaskResult[]): ExperimentRecord | undefined {
    const cur = this.get(experimentTag);
    if (!cur) return undefined;
    const norm = normalizeResults(experimentTag, results);
    const merged: ExperimentRecord = {
      ...cur,
      results: norm,
      nRuns: norm.reduce((s, r) => s + r.baseN + r.candN, 0),
      updatedAt: new Date().toISOString(),
    };
    this.append(merged);
    return merged;
  }

  /** Record the Monte-Carlo gate's verdict. This is the ONLY path that sets a
   *  non-'pending' decision — keeps the statistical discipline in one place. */
  decide(experimentTag: string, d: DecisionUpdate): ExperimentRecord | undefined {
    const cur = this.get(experimentTag);
    if (!cur) return undefined;
    const merged: ExperimentRecord = {
      ...cur,
      decision: d.decision,
      pValue: d.pValue ?? cur.pValue,
      ciLow: d.ciLow ?? cur.ciLow,
      ciHigh: d.ciHigh ?? cur.ciHigh,
      fwerAdjusted: d.fwerAdjusted ?? cur.fwerAdjusted,
      nRuns: d.nRuns ?? cur.nRuns,
      reason: d.reason ?? cur.reason,
      mergedCommit: d.mergedCommit ?? cur.mergedCommit,
      updatedAt: new Date().toISOString(),
    };
    this.append(merged);
    return merged;
  }

  /** Experiments awaiting a decision — what the gate processes next. */
  pending(): ExperimentRecord[] {
    return this.list({ decision: 'pending' });
  }

  /**
   * Flatten all experiments' per-task rows into the STDB `experiment_task_result`
   * shape. The nexus Layer-3 ingest consumes exactly this — header rows from
   * `list()`, child rows from here.
   */
  allTaskResults(): ExperimentTaskResult[] {
    return this.list().flatMap(e => e.results);
  }
}
