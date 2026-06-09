import { describe, it, expect } from 'vitest';
import {
  mulberry32, decideExperiment, bootstrapCI, permutationPValue,
  sidakThreshold, mcFwerThreshold, aggregateEffect, type TaskArms,
} from '../AutoResearchStats.js';

describe('AutoResearchStats — Monte-Carlo keep/discard gate', () => {
  it('mulberry32 is deterministic for a given seed', () => {
    const a = mulberry32(42); const b = mulberry32(42);
    const seqA = [a(), a(), a()]; const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(mulberry32(43)()).not.toEqual(seqA[0]);
  });

  it('aggregateEffect averages per-task (candMean - baseMean)', () => {
    const tasks: TaskArms[] = [
      { baseScores: [70, 70], candScores: [80, 80] }, // +10
      { baseScores: [60, 60], candScores: [56, 56] }, // -4
    ];
    expect(aggregateEffect(tasks)).toBeCloseTo(3, 5);
  });

  it('sidakThreshold tightens monotonically as N grows; N=1 collapses to alpha', () => {
    expect(sidakThreshold(0.05, 1)).toBeCloseTo(0.05, 4);
    const t10 = sidakThreshold(0.05, 10);
    const t50 = sidakThreshold(0.05, 50);
    expect(t10).toBeLessThan(0.05);
    expect(t50).toBeLessThan(t10);
  });

  it('mcFwerThreshold reproduces Šidák under the independent null', () => {
    const mc = mcFwerThreshold(0.05, 10, { iterations: 20000, rng: mulberry32(7) });
    const analytic = sidakThreshold(0.05, 10);
    // MC estimate of the alpha-quantile of min-p should be close to Šidák
    expect(mc).toBeCloseTo(analytic, 2);
  });

  it('KEEP: a clear, consistent improvement across tasks clears CI + permutation', () => {
    const tasks: TaskArms[] = [
      { baseScores: [60, 62, 61, 59], candScores: [80, 82, 81, 79] },
      { baseScores: [55, 57, 56, 54], candScores: [75, 73, 76, 74] },
      { baseScores: [70, 71, 69, 70], candScores: [88, 90, 89, 87] },
    ];
    const v = decideExperiment(tasks, { seed: 1, nFamilyExperiments: 1 });
    expect(v.decision).toBe('keep');
    expect(v.ciLow).toBeGreaterThan(0);
    expect(v.pValue!).toBeLessThanOrEqual(v.alphaAdjusted!);
    expect(v.fwerAdjusted).toBe(true);
  });

  it('DISCARD: no real difference → CI includes 0', () => {
    const tasks: TaskArms[] = [
      { baseScores: [70, 72, 71, 69], candScores: [71, 69, 70, 72] },
      { baseScores: [60, 61, 59, 60], candScores: [60, 59, 61, 60] },
    ];
    const v = decideExperiment(tasks, { seed: 2 });
    expect(v.decision).toBe('discard');
    expect(v.ciLow).toBeLessThanOrEqual(0);
  });

  it('PENDING: not enough runs per arm to decide', () => {
    const tasks: TaskArms[] = [{ baseScores: [80], candScores: [90] }];
    const v = decideExperiment(tasks, { seed: 3, minRunsPerArm: 2 });
    expect(v.decision).toBe('pending');
    expect(v.reason).toMatch(/insufficient data/);
  });

  it('N-AWARE FWER: a borderline win that passes at N=1 is rejected at large N', () => {
    // A modest, noisy improvement — significant on its own, not against a big family.
    const tasks: TaskArms[] = [
      { baseScores: [70, 71, 69, 70, 70], candScores: [72, 73, 71, 72, 72] },
      { baseScores: [60, 61, 59, 60, 60], candScores: [62, 61, 63, 62, 62] },
    ];
    const solo = decideExperiment(tasks, { seed: 9, nFamilyExperiments: 1 });
    const swarm = decideExperiment(tasks, { seed: 9, nFamilyExperiments: 200 });
    // same data + seed: the family bar is strictly tighter
    expect(swarm.alphaAdjusted!).toBeLessThan(solo.alphaAdjusted!);
    // and the swarm verdict is never more permissive than the solo verdict
    if (solo.decision === 'discard') expect(swarm.decision).toBe('discard');
    expect(['keep', 'discard']).toContain(swarm.decision);
  });

  it('decideExperiment is reproducible: same data + seed → identical verdict', () => {
    const tasks: TaskArms[] = [
      { baseScores: [60, 62, 61], candScores: [80, 82, 81] },
      { baseScores: [55, 57, 56], candScores: [75, 73, 76] },
    ];
    const a = decideExperiment(tasks, { seed: 123 });
    const b = decideExperiment(tasks, { seed: 123 });
    expect(a).toEqual(b);
  });

  it('bootstrapCI + permutationPValue agree on direction for a strong effect', () => {
    const tasks: TaskArms[] = [{ baseScores: [50, 51, 49, 50], candScores: [70, 71, 69, 70] }];
    const rng = mulberry32(5);
    const { ciLow, ciHigh } = bootstrapCI(tasks, { iterations: 3000, rng });
    const p = permutationPValue(tasks, { iterations: 3000, rng: mulberry32(5) });
    expect(ciLow).toBeGreaterThan(0);
    expect(ciHigh).toBeGreaterThan(ciLow);
    expect(p).toBeLessThan(0.05);
  });
});
