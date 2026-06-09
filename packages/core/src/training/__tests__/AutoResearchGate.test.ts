import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModelRouterMatrix, type BenchmarkRecord } from '../ModelRouterMatrix.js';
import { ExperimentLedger } from '../ExperimentLedger.js';
import { evaluateExperiment, verifyOnHoldout } from '../AutoResearchGate.js';

function rec(p: Partial<BenchmarkRecord>): BenchmarkRecord {
  return {
    modelId: 'deepseek-v4-flash', taskType: 'T1', toolCallCount: 3,
    inputTokens: 1000, outputTokens: 500, latencyMs: 5000, pass: true,
    qualitativeScore: 80, split: 'train', benchmarkSource: 'cortex-bench', ...p,
  };
}

describe('AutoResearchGate — end-to-end decision pipeline', () => {
  let root: string;
  let m: ModelRouterMatrix;
  let led: ExperimentLedger;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'argate-'));
    m = new ModelRouterMatrix(root);
    led = new ExperimentLedger(root);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function seedImprovement(harnessBase: string, harnessCand: string) {
    const tasks = ['fp1', 'fp2', 'fp3'];
    for (const fp of tasks) {
      for (const s of [60, 62, 61, 59]) m.record(rec({ taskFingerprint: fp, harnessRef: harnessBase, qualitativeScore: s }));
      for (const s of [80, 82, 81, 79]) m.record(rec({ taskFingerprint: fp, harnessRef: harnessCand, qualitativeScore: s }));
    }
  }

  it('keeps a real improvement and writes an audited record to the ledger', () => {
    seedImprovement('base1', 'cand1');
    const res = evaluateExperiment(m, led, {
      experimentTag: 'swarm-A', baseRef: 'base1', candidateRef: 'cand1', branch: 'exp/A',
      deficiencyId: 'def-abc', gate: { seed: 1 },
    });
    expect(res.verdict.decision).toBe('keep');
    expect(res.regressedTasks).toEqual([]);
    // persisted + audited
    const stored = led.get('swarm-A')!;
    expect(stored.decision).toBe('keep');
    expect(stored.fwerAdjusted).toBe(true);
    expect(stored.ciLow).toBeGreaterThan(0);
    expect(stored.deficiencyId).toBe('def-abc');
    expect(stored.results).toHaveLength(3); // one child row per task
  });

  it('discards when the candidate is no better than base', () => {
    for (const fp of ['fp1', 'fp2']) {
      for (const s of [70, 71, 69, 70]) m.record(rec({ taskFingerprint: fp, harnessRef: 'b', qualitativeScore: s }));
      for (const s of [70, 69, 71, 70]) m.record(rec({ taskFingerprint: fp, harnessRef: 'c', qualitativeScore: s }));
    }
    const res = evaluateExperiment(m, led, {
      experimentTag: 'swarm-B', baseRef: 'b', candidateRef: 'c', branch: 'exp/B', gate: { seed: 2 },
    });
    expect(res.verdict.decision).toBe('discard');
    expect(led.get('swarm-B')!.decision).toBe('discard');
  });

  it('flags collateral regressions in the reason even on an aggregate keep', () => {
    // two tasks improve a lot, one regresses — aggregate positive but fp3 broke.
    for (const s of [60, 61, 59, 60]) m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'b', qualitativeScore: s }));
    for (const s of [90, 91, 89, 90]) m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'c', qualitativeScore: s }));
    for (const s of [60, 61, 59, 60]) m.record(rec({ taskFingerprint: 'fp2', harnessRef: 'b', qualitativeScore: s }));
    for (const s of [90, 91, 89, 90]) m.record(rec({ taskFingerprint: 'fp2', harnessRef: 'c', qualitativeScore: s }));
    for (const s of [80, 81, 79, 80]) m.record(rec({ taskFingerprint: 'fp3', harnessRef: 'b', qualitativeScore: s }));
    for (const s of [60, 61, 59, 60]) m.record(rec({ taskFingerprint: 'fp3', harnessRef: 'c', qualitativeScore: s }));
    const res = evaluateExperiment(m, led, {
      experimentTag: 'swarm-C', baseRef: 'b', candidateRef: 'c', branch: 'exp/C', gate: { seed: 4 },
    });
    expect(res.regressedTasks).toContain('fp3');
    if (res.verdict.decision === 'keep') {
      expect(led.get('swarm-C')!.reason).toMatch(/regressed/i);
    }
  });

  it('verifyOnHoldout returns null with no holdout records, and a verdict once present', () => {
    seedImprovement('base2', 'cand2'); // train only
    expect(verifyOnHoldout(m, { baseRef: 'base2', candidateRef: 'cand2', gate: { seed: 5 } })).toBeNull();
    // now add holdout evidence
    for (const fp of ['hfp1', 'hfp2']) {
      for (const s of [60, 61, 59, 60]) m.record(rec({ taskFingerprint: fp, harnessRef: 'base2', qualitativeScore: s, split: 'holdout' }));
      for (const s of [78, 79, 80, 81]) m.record(rec({ taskFingerprint: fp, harnessRef: 'cand2', qualitativeScore: s, split: 'holdout' }));
    }
    const v = verifyOnHoldout(m, { baseRef: 'base2', candidateRef: 'cand2', gate: { seed: 5 } });
    expect(v).not.toBeNull();
    expect(v!.decision).toBe('keep');
  });

  it('N-aware: the same kept experiment can drop to discard under a large family', () => {
    // modest improvement: holds solo, may not survive a 500-wide family bar.
    for (const fp of ['fp1', 'fp2']) {
      for (const s of [70, 71, 69, 70, 70]) m.record(rec({ taskFingerprint: fp, harnessRef: 'b', qualitativeScore: s }));
      for (const s of [73, 74, 72, 73, 73]) m.record(rec({ taskFingerprint: fp, harnessRef: 'c', qualitativeScore: s }));
    }
    const solo = evaluateExperiment(m, led, { experimentTag: 's-solo', baseRef: 'b', candidateRef: 'c', branch: 'x', nFamilyExperiments: 1, gate: { seed: 6 } });
    const swarm = evaluateExperiment(m, led, { experimentTag: 's-swarm', baseRef: 'b', candidateRef: 'c', branch: 'x', nFamilyExperiments: 500, gate: { seed: 6 } });
    expect(swarm.verdict.alphaAdjusted!).toBeLessThan(solo.verdict.alphaAdjusted!);
  });
});
