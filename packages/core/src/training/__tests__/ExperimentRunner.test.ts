import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModelRouterMatrix } from '../ModelRouterMatrix.js';
import { ExperimentLedger } from '../ExperimentLedger.js';
import { runExperiment, type ExperimentArms } from '../ExperimentRunner.js';
import type { HarnessRunner, HarnessRunResult, TaskSpec } from '../BenchRunner.js';

/** A runner that always returns the same output (so grades are deterministic). */
function fixedRunner(output: string): HarnessRunner {
  return {
    async run(): Promise<HarnessRunResult> {
      return { text: output, modelId: 'deepseek-v4-flash', inputTokens: 100, outputTokens: 50, toolCallCount: 1, latencyMs: 1000 };
    },
  };
}

// contains-verifier tasks → partial-credit continuous scores the gate can separate.
const TRAIN: TaskSpec[] = [
  { id: 't1', taskType: 'T1', prompt: 'p1', verifier: { type: 'contains', all: ['alpha', 'beta', 'gamma', 'delta'] } },
  { id: 't2', taskType: 'T1', prompt: 'p2', verifier: { type: 'contains', all: ['alpha', 'beta', 'gamma', 'delta'] } },
];
const HOLDOUT: TaskSpec[] = [
  { id: 'h1', taskType: 'T1', prompt: 'hp1', verifier: { type: 'contains', all: ['alpha', 'beta', 'gamma', 'delta'] } },
  { id: 'h2', taskType: 'T1', prompt: 'hp2', verifier: { type: 'contains', all: ['alpha', 'beta', 'gamma', 'delta'] } },
];

describe('runExperiment — single-experiment measurement core', () => {
  let root: string;
  let matrix: ModelRouterMatrix;
  let ledger: ExperimentLedger;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'exprun-'));
    matrix = new ModelRouterMatrix(root);
    ledger = new ExperimentLedger(root);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('KEEP + mergeEligible when candidate clearly beats base on train AND holdout', async () => {
    // base output has 1/4 needles (score 25); candidate has 4/4 (score 100).
    const arms: ExperimentArms = { baseRunner: fixedRunner('alpha only'), candidateRunner: fixedRunner('alpha beta gamma delta') };
    const res = await runExperiment(matrix, ledger, arms, {
      experimentTag: 'swarm-keep', baseRef: 'base1', candidateRef: 'cand1', branch: 'exp/x',
      trainTasks: TRAIN, holdoutTasks: HOLDOUT, runs: 3, nFamily: 1, gate: { seed: 1 },
    });
    expect(res.verdict.decision).toBe('keep');
    expect(res.verdict.fwerAdjusted).toBe(true);
    expect(res.holdoutVerdict?.decision).toBe('keep');
    expect(res.mergeEligible).toBe(true);
    // records: base+cand × train(2 tasks×3) and × holdout(2 tasks×3) = 12 each
    expect(matrix.getRecords({ split: 'train' }).length).toBe(12);
    expect(matrix.getRecords({ split: 'holdout' }).length).toBe(12);
    // ledger persisted the keep verdict
    expect(ledger.get('swarm-keep')!.decision).toBe('keep');
  });

  it('DISCARD when candidate is no better than base', async () => {
    const arms: ExperimentArms = { baseRunner: fixedRunner('alpha beta'), candidateRunner: fixedRunner('alpha beta') };
    const res = await runExperiment(matrix, ledger, arms, {
      experimentTag: 'swarm-discard', baseRef: 'b', candidateRef: 'c', branch: 'x',
      trainTasks: TRAIN, holdoutTasks: HOLDOUT, runs: 3, gate: { seed: 2 },
    });
    expect(res.verdict.decision).toBe('discard');
    expect(res.mergeEligible).toBe(false);
  });

  it('NOT mergeEligible without a holdout set, even on a train keep (fixed != verified)', async () => {
    const arms: ExperimentArms = { baseRunner: fixedRunner('alpha'), candidateRunner: fixedRunner('alpha beta gamma delta') };
    const res = await runExperiment(matrix, ledger, arms, {
      experimentTag: 'swarm-noholdout', baseRef: 'b', candidateRef: 'c', branch: 'x',
      trainTasks: TRAIN, runs: 3, gate: { seed: 3 },
    });
    expect(res.verdict.decision).toBe('keep');     // train says keep
    expect(res.holdoutVerdict).toBeNull();          // nothing verified it
    expect(res.mergeEligible).toBe(false);          // → not mergeable
    expect(matrix.getRecords({ split: 'holdout' }).length).toBe(0);
  });

  it('benchSummaries report per-arm mean scores', async () => {
    const arms: ExperimentArms = { baseRunner: fixedRunner('alpha'), candidateRunner: fixedRunner('alpha beta gamma delta') };
    const res = await runExperiment(matrix, ledger, arms, {
      experimentTag: 's', baseRef: 'b', candidateRef: 'c', branch: 'x',
      trainTasks: TRAIN, holdoutTasks: HOLDOUT, runs: 2, gate: { seed: 4 },
    });
    expect(res.benchSummaries.base.train.tasks[0]!.meanScore).toBe(25);    // 1/4
    expect(res.benchSummaries.candidate.train.tasks[0]!.meanScore).toBe(100); // 4/4
    expect(res.benchSummaries.base.holdout!.tasks[0]!.meanScore).toBe(25);
    expect(res.benchSummaries.candidate.holdout).toBeDefined();
  });

  it('records the effectiveness-arm temperature + strategy on BOTH base and candidate', async () => {
    const arms: ExperimentArms = { baseRunner: fixedRunner('alpha'), candidateRunner: fixedRunner('alpha beta gamma delta') };
    await runExperiment(matrix, ledger, arms, {
      experimentTag: 's-arm', baseRef: 'b', candidateRef: 'c', branch: 'x',
      trainTasks: TRAIN, runs: 2, gate: { seed: 6 },
      temperature: 0.3, strategy: 'precise',
    });
    const recs = matrix.getRecords({ split: 'train' });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every(r => r.temperature === 0.3 && r.strategy === 'precise')).toBe(true);
    // both harness arms carry the shared arm config
    expect(matrix.getRecords({ harnessRef: 'b' }).every(r => r.strategy === 'precise')).toBe(true);
    expect(matrix.getRecords({ harnessRef: 'c' }).every(r => r.strategy === 'precise')).toBe(true);
  });

  it('progress callback fires for each phase', async () => {
    const msgs: string[] = [];
    const arms: ExperimentArms = { baseRunner: fixedRunner('alpha'), candidateRunner: fixedRunner('alpha beta gamma delta') };
    await runExperiment(matrix, ledger, arms, {
      experimentTag: 's', baseRef: 'b', candidateRef: 'c', branch: 'x',
      trainTasks: TRAIN, holdoutTasks: HOLDOUT, runs: 2, gate: { seed: 5 },
      onProgress: m => msgs.push(m),
    });
    expect(msgs.some(m => /base\/train/.test(m))).toBe(true);
    expect(msgs.some(m => /candidate\/holdout/.test(m))).toBe(true);
    expect(msgs.some(m => /gate/.test(m))).toBe(true);
  });
});

describe('runExperiment — interleaving (B5) and run planning', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'exprun-il-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  /** Two IDENTICAL arms on a drifting provider: the first half of all calls (any arm)
   *  score 100, the second half 25. Only the run order separates the arms. */
  function driftingArms(totalCalls: number): ExperimentArms & { calls: string[] } {
    const calls: string[] = [];
    const mk = (name: string): HarnessRunner => ({
      async run(): Promise<HarnessRunResult> {
        calls.push(name);
        const early = calls.length <= totalCalls / 2;
        return { text: early ? 'alpha beta gamma delta' : 'alpha', inputTokens: 1, outputTokens: 1, toolCallCount: 0, latencyMs: 1 };
      },
    });
    return { baseRunner: mk('base'), candidateRunner: mk('cand'), calls };
  }

  it('sequential order turns provider drift into a fake effect; interleaving cancels it', async () => {
    const opts = { baseRef: 'b', candidateRef: 'c', branch: 'x', trainTasks: TRAIN, runs: 6, gate: { seed: 3 } };
    const seq = driftingArms(24);
    const rs = await runExperiment(new ModelRouterMatrix(path.join(root, 's')), new ExperimentLedger(path.join(root, 's')), seq,
      { ...opts, experimentTag: 'seq', interleave: false });
    const il = driftingArms(24);
    const ri = await runExperiment(new ModelRouterMatrix(path.join(root, 'i')), new ExperimentLedger(path.join(root, 'i')), il,
      { ...opts, experimentTag: 'il' });
    expect(rs.interleaved).toBe(false);
    expect(seq.calls.slice(0, 12).every((c) => c === 'base')).toBe(true);
    expect(rs.verdict.effect).toBeLessThan(-50);            // identical arms, "candidate is worse"
    expect(ri.interleaved).toBe(true);
    expect(Math.abs(ri.verdict.effect)).toBeLessThan(20);   // drift shared by both arms
    expect(ri.verdict.decision).not.toBe('keep');
    // same records either way: 2 tasks × 6 runs per arm
    expect(il.calls.filter((c) => c === 'base').length).toBe(12);
    expect(il.calls.filter((c) => c === 'cand').length).toBe(12);
  });

  it('interleaving order is seeded (reproducible) and mixes who goes first', async () => {
    const order = async () => {
      const a = driftingArms(1000);
      await runExperiment(new ModelRouterMatrix(fs.mkdtempSync(path.join(root, 'o'))), new ExperimentLedger(fs.mkdtempSync(path.join(root, 'l'))), a,
        { experimentTag: 'ord', baseRef: 'b', candidateRef: 'c', branch: 'x', trainTasks: TRAIN, runs: 8, gate: { seed: 9 } });
      return a.calls;
    };
    const first = await order();
    expect(await order()).toEqual(first);
    const pairsBaseFirst = first.filter((c, i) => i % 2 === 0 && c === 'base').length;
    expect(pairsBaseFirst).toBeGreaterThan(0);
    expect(pairsBaseFirst).toBeLessThan(16);
  });

  it('reports a run plan from the observed per-task spread', async () => {
    let k = 0;
    const noisy: HarnessRunner = { async run() { k++; return { text: k % 2 ? 'alpha beta gamma delta' : 'alpha', inputTokens: 1, outputTokens: 1, toolCallCount: 0, latencyMs: 1 }; } };
    const res = await runExperiment(new ModelRouterMatrix(root), new ExperimentLedger(root), { baseRunner: noisy, candidateRunner: noisy },
      { experimentTag: 'plan', baseRef: 'b', candidateRef: 'c', branch: 'x', trainTasks: TRAIN, runs: 3, gate: { seed: 1 }, plan: { targetEffect: 5 } });
    expect(res.runPlan).toBeDefined();
    expect(res.runPlan!.runsPerArm).toBe(3);
    expect(res.runPlan!.adequate).toBe(false);
    expect(res.runPlan!.requiredRunsPerArm).toBeGreaterThan(3);
    expect(res.benchSummaries.base.train.tasks[0]!.scoreSd).toBeGreaterThan(0);
  });
});
