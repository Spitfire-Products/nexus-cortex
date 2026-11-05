import { describe, it, expect } from 'vitest';
import { decideConfirmation, gateZ, normalCdf, normalQuantile, planRuns, sampleSd } from '../AutoResearchConfirm.js';
import type { ExperimentVerdict } from '../AutoResearchStats.js';

const v = (o: Partial<ExperimentVerdict>): ExperimentVerdict => ({
  decision: 'keep', effect: 5, pValue: 0.01, ciLow: 1, ciHigh: 9, fwerAdjusted: true, alphaAdjusted: 0.05,
  nRuns: 12, nTasks: 2, reason: 'test', ...o,
});

describe('normal helpers', () => {
  it('quantile inverts the cdf', () => {
    for (const p of [0.001, 0.025, 0.2, 0.5, 0.8, 0.975, 0.999]) expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 5);
    expect(normalQuantile(0.975)).toBeCloseTo(1.96, 2);
  });
  it('the gate bar is the stricter of the CI (two-sided) and the adjusted alpha (one-sided)', () => {
    expect(gateZ(0.05)).toBeCloseTo(1.96, 2);            // CI binds
    expect(gateZ(0.0170)).toBeCloseTo(2.12, 2);           // Šidák for 3 arms binds
  });
});

describe('decideConfirmation', () => {
  it('pooled: a real gain whose fresh run is positive but not significant on its own is confirmed', () => {
    const d = decideConfirmation(v({ pValue: 0.004 }), v({ decision: 'discard', effect: 3, pValue: 0.09 }));
    expect(d.mode).toBe('pooled');
    expect(d.confirmed).toBe(true);
    expect(d.combinedP!).toBeLessThan(0.025);
  });
  it('pooled: a lucky winner whose fresh effect is ~0 is not confirmed', () => {
    expect(decideConfirmation(v({ pValue: 0.012 }), v({ decision: 'discard', effect: 0.4, pValue: 0.45 })).confirmed).toBe(false);
    // any fresh effect <= 0 fails, however strong the screening was
    expect(decideConfirmation(v({ pValue: 0.0005 }), v({ decision: 'discard', effect: -0.5, pValue: 0.6 })).confirmed).toBe(false);
  });
  it('strict demands a second keep; direction demands effect > 0 and CI low above -margin', () => {
    const fresh = v({ decision: 'discard', effect: 3, pValue: 0.09, ciLow: -1 });
    expect(decideConfirmation(v({}), fresh, { mode: 'strict' }).confirmed).toBe(false);
    expect(decideConfirmation(v({}), fresh, { mode: 'direction' }).confirmed).toBe(true);
    expect(decideConfirmation(v({}), { ...fresh, ciLow: -4 }, { mode: 'direction' }).confirmed).toBe(false);
    expect(decideConfirmation(v({}), { ...fresh, ciLow: -4 }, { mode: 'direction', lossMargin: 5 }).confirmed).toBe(true);
  });
  it('a pending confirmation (too little data) never confirms', () => {
    expect(decideConfirmation(v({}), v({ decision: 'pending', pValue: undefined }), { mode: 'direction' }).confirmed).toBe(false);
  });
});

describe('planRuns', () => {
  it('reports the detectable effect and the runs needed for the target', () => {
    // 2 tasks, per-run SD 10 on both arms: V1 = (2 × 200) / 4 = 100; at n=3 SE = 5.77
    const p = planRuns([{ baseSd: 10, candSd: 10 }, { baseSd: 10, candSd: 10 }], { runsPerArm: 3, targetEffect: 5 });
    expect(p.seEffect).toBeCloseTo(5.7735, 3);
    expect(p.detectableEffect).toBeCloseTo((1.96 + 0.8416) * 5.7735, 1);
    expect(p.requiredRunsPerArm).toBe(Math.ceil(((1.96 + 0.8416) ** 2 * 100) / 25)); // 32
    expect(p.adequate).toBe(false);
  });
  it('deterministic scores need only the gate minimum', () => {
    const p = planRuns([{ baseSd: 0, candSd: 0 }], { runsPerArm: 2 });
    expect(p.requiredRunsPerArm).toBe(2);
    expect(p.adequate).toBe(true);
  });
  it('a family-adjusted alpha raises the requirement', () => {
    const t = [{ baseSd: 8, candSd: 8 }];
    expect(planRuns(t, { runsPerArm: 3, alphaAdjusted: 0.0017 }).requiredRunsPerArm)
      .toBeGreaterThan(planRuns(t, { runsPerArm: 3, alphaAdjusted: 0.05 }).requiredRunsPerArm);
  });
  it('sampleSd', () => {
    expect(sampleSd([1])).toBe(0);
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
});

describe('stage consistency', () => {
  it('a fresh run that collapses against an extreme screening is not confirmed (the e2e lucky winner)', () => {
    // end-to-end numbers: screening +39.25, CI [38.75, 39.75], p 0.0005; fresh +0.75, CI [-0.25, 1.75], p 0.056
    const screen = v({ effect: 39.25, ciLow: 38.75, ciHigh: 39.75, pValue: 0.0005 });
    const fresh = v({ decision: 'discard', effect: 0.75, ciLow: -0.25, ciHigh: 1.75, pValue: 0.056 });
    const d = decideConfirmation(screen, fresh);
    expect(d.confirmed).toBe(false);
    expect(d.shortfallZ!).toBeGreaterThan(30);
    expect(d.reason).toMatch(/behaved differently between the stages/);
    expect(decideConfirmation(screen, fresh, { mode: 'direction', lossMargin: 5 }).confirmed).toBe(false);
  });
  it('ordinary regression to the mean still confirms', () => {
    // screening +6 (CI 1..11), fresh +3 (CI -2..8): shortfall z ≈ 0.83
    const d = decideConfirmation(v({ effect: 6, ciLow: 1, ciHigh: 11, pValue: 0.01 }), v({ decision: 'discard', effect: 3, ciLow: -2, ciHigh: 8, pValue: 0.12 }));
    expect(d.shortfallZ!).toBeLessThan(1);
    expect(d.confirmed).toBe(true);
  });
});
