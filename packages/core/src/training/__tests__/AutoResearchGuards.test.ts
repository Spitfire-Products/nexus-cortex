import { describe, it, expect } from 'vitest';
import { familyEffects, stepGuards, totalGuards, recordDrift, describeGuardBlocks, type DriftLedger } from '../AutoResearchGuards.js';
import { mulberry32, type TaskArms } from '../AutoResearchStats.js';

// B4: a gain on the aggregate must not hide a loss in one task family.
const fixed = (base: number, cand: number, family: string, n = 4): TaskArms =>
  ({ baseScores: Array(n).fill(base), candScores: Array(n).fill(cand), taskFamily: family });

function noisy(rng: () => number, baseMean: number, candMean: number, family: string, n: number, sd: number): TaskArms {
  const g = () => { const u = Math.max(rng(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); };
  return {
    baseScores: Array.from({ length: n }, () => baseMean + sd * g()),
    candScores: Array.from({ length: n }, () => candMean + sd * g()),
    taskFamily: family,
  };
}

describe('step guard', () => {
  it('blocks a family with a clear, material loss even when the aggregate gains', () => {
    // T1 +30 on two tasks, T2 -10 on one task (aggregate positive)
    const fams = familyEffects([fixed(50, 80, 'T1'), fixed(50, 80, 'T1'), fixed(60, 50, 'T2')], { seed: 1 });
    const g = stepGuards(fams);
    expect(g.find((x) => x.family === 'T2')!.blocked).toBe(true);
    expect(g.find((x) => x.family === 'T1')!.blocked).toBe(false);
    expect(describeGuardBlocks(g)).toMatch(/^T2 step -10/);
  });
  it('a loss smaller than the margin does not block, however certain', () => {
    expect(stepGuards(familyEffects([fixed(60, 59, 'T2')], { seed: 1 }))[0]!.blocked).toBe(false);
  });
  it('a noisy loss past the margin without evidence does not block', () => {
    const rng = mulberry32(7);
    const fams = familyEffects([noisy(rng, 60, 56, 'T2', 3, 15)], { seed: 2 });
    expect(fams[0]!.effect).toBeLessThan(0);
    expect(stepGuards(fams)[0]!.blocked).toBe(false);
  });
  it('under no change, false blocks stay near alpha per round (3 families, noisy model scores)', () => {
    const rng = mulberry32(11);
    let blockedRounds = 0;
    const R = 300;
    for (let r = 0; r < R; r++) {
      const tasks = ['T1', 'T2', 'T3'].flatMap((f) => [noisy(rng, 60, 60, f, 4, 12), noisy(rng, 60, 60, f, 4, 12)]);
      if (stepGuards(familyEffects(tasks, { seed: r, iterations: 600 })).some((g) => g.blocked)) blockedRounds++;
    }
    expect(blockedRounds / R).toBeLessThan(0.08);
  });
});

describe('running total (drift from the round-0 base)', () => {
  it('blocks slow drift that no single step would', () => {
    const ledger: DriftLedger = new Map();
    const step = familyEffects([fixed(60, 58.5, 'T2', 6)], { seed: 3 }); // -1.5 per step, under the 2-pt step margin
    for (let i = 0; i < 3; i++) {
      expect(stepGuards(step)[0]!.blocked).toBe(false);
      expect(totalGuards(ledger, step)[0]!.blocked).toBe(false);
      recordDrift(ledger, step);
    }
    // 4th merge would take T2 to -6 (< -5) with evidence → blocked
    const t = totalGuards(ledger, step)[0]!;
    expect(t.effect).toBeCloseTo(-6, 5);
    expect(t.blocked).toBe(true);
    expect(ledger.get('T2')!.steps).toBe(3);
  });
  it('gains in other rounds offset a family\'s earlier losses', () => {
    const ledger: DriftLedger = new Map();
    recordDrift(ledger, familyEffects([fixed(60, 56, 'T2')], { seed: 4 }));
    recordDrift(ledger, familyEffects([fixed(56, 60, 'T2')], { seed: 5 }));
    expect(totalGuards(ledger, familyEffects([fixed(60, 58.5, 'T2')], { seed: 6 }))[0]!.blocked).toBe(false);
  });
});
