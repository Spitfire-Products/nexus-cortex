import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModelRouterMatrix, type BenchmarkRecord } from '../ModelRouterMatrix.js';
import { compareVersions, regressionScan, toTaskResult } from '../VersionComparison.js';

function rec(p: Partial<BenchmarkRecord>): BenchmarkRecord {
  return {
    modelId: 'deepseek-v4-flash',
    taskType: 'T1',
    toolCallCount: 3,
    inputTokens: 1000,
    outputTokens: 500,
    latencyMs: 5000,
    pass: true,
    qualitativeScore: 80,
    split: 'train',
    benchmarkSource: 'cortex-bench',
    ...p,
  };
}

describe('VersionComparison — base-vs-candidate harness comparison', () => {
  let root: string;
  let m: ModelRouterMatrix;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vercmp-'));
    m = new ModelRouterMatrix(root);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('compareVersions returns raw per-run arrays, means, delta, and N per arm', () => {
    // base 'aaa' scored 70/72 on fp1; candidate 'bbb' scored 84/86
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'aaa', qualitativeScore: 70 }));
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'aaa', qualitativeScore: 72 }));
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'bbb', qualitativeScore: 84 }));
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'bbb', qualitativeScore: 86 }));

    const cmp = compareVersions(m, 'fp1', 'aaa', 'bbb');
    expect(cmp.baseScores.sort()).toEqual([70, 72]);
    expect(cmp.candScores.sort()).toEqual([84, 86]);
    expect(cmp.baseMean).toBe(71);
    expect(cmp.candMean).toBe(85);
    expect(cmp.delta).toBe(14);
    expect(cmp.baseN).toBe(2);
    expect(cmp.candN).toBe(2);
    expect(cmp.sufficient).toBe(true);
  });

  it('OVERFITTING GUARD: holdout records are excluded from the default (train) comparison', () => {
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'bbb', qualitativeScore: 90, split: 'train' }));
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'bbb', qualitativeScore: 10, split: 'holdout' }));
    const train = compareVersions(m, 'fp1', 'aaa', 'bbb');
    expect(train.candScores).toEqual([90]); // holdout 10 not pulled
    const hold = compareVersions(m, 'fp1', 'aaa', 'bbb', { split: 'holdout' });
    expect(hold.candScores).toEqual([10]);
  });

  it('sufficient=false when either arm is below minN', () => {
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'aaa', qualitativeScore: 70 }));
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'bbb', qualitativeScore: 90 }));
    const cmp = compareVersions(m, 'fp1', 'aaa', 'bbb', { minN: 2 });
    expect(cmp.baseN).toBe(1);
    expect(cmp.sufficient).toBe(false);
  });

  it('regressionScan classifies improvements, regressions, neutral, and uncompared', () => {
    // fp1: improvement (70->85). fp2: regression (80->60). fp3: neutral (50->50.2).
    // fp4: candidate-only -> uncompared.
    for (const s of [70, 71]) m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'aaa', qualitativeScore: s }));
    for (const s of [85, 86]) m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'bbb', qualitativeScore: s }));
    for (const s of [80, 81]) m.record(rec({ taskFingerprint: 'fp2', harnessRef: 'aaa', qualitativeScore: s }));
    for (const s of [60, 61]) m.record(rec({ taskFingerprint: 'fp2', harnessRef: 'bbb', qualitativeScore: s }));
    for (const s of [50, 50]) m.record(rec({ taskFingerprint: 'fp3', harnessRef: 'aaa', qualitativeScore: s }));
    for (const s of [50, 50.2] as number[]) m.record(rec({ taskFingerprint: 'fp3', harnessRef: 'bbb', qualitativeScore: s }));
    for (const s of [99, 99]) m.record(rec({ taskFingerprint: 'fp4', harnessRef: 'bbb', qualitativeScore: s }));

    const report = regressionScan(m, 'bbb', 'aaa', { epsilon: 0.5 });
    expect(report.improvements.map(c => c.taskFingerprint)).toContain('fp1');
    expect(report.regressions.map(c => c.taskFingerprint)).toContain('fp2');
    expect(report.neutral.map(c => c.taskFingerprint)).toContain('fp3');
    expect(report.uncompared).toContain('fp4');
    // mean delta over sufficient cells (fp1 +15, fp2 -20, fp3 +0.1) = -1.633
    expect(report.meanDelta).toBeCloseTo((15 - 20 + 0.1) / 3, 2);
  });

  it('toTaskResult maps a comparison to the ExperimentLedger child-row shape', () => {
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'aaa', qualitativeScore: 60 }));
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'aaa', qualitativeScore: 60 }));
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'bbb', qualitativeScore: 70 }));
    m.record(rec({ taskFingerprint: 'fp1', harnessRef: 'bbb', qualitativeScore: 70 }));
    const row = toTaskResult('swarm-01', compareVersions(m, 'fp1', 'aaa', 'bbb'));
    expect(row).toEqual({ experimentTag: 'swarm-01', taskFingerprint: 'fp1', baseScore: 60, candScore: 70, delta: 10, baseN: 2, candN: 2 });
  });
});
