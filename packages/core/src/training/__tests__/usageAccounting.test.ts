import { describe, it, expect } from 'vitest';
import { emptySessionUsage, addMainUsage, addHelperEstimate, usageCost } from '../usageAccounting.js';

describe('R190 cumulative usage', () => {
  it('accumulates every main request, derives uncached from input minus cache-read when absent, ignores empty usage', () => {
    let a = emptySessionUsage();
    a = addMainUsage(a, { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cache: { cacheReadTokens: 800, cacheCreationTokens: 0, uncachedInputTokens: 200, cacheHitRate: 0.8 } } as any);
    a = addMainUsage(a, { inputTokens: 1500, outputTokens: 50, totalTokens: 1550, cache: { cacheReadTokens: 1400 } as any, reasoningTokens: 30 } as any);
    a = addMainUsage(a, { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as any);
    a = addMainUsage(a, undefined);
    expect(a).toMatchObject({ requests: 2, inputTokens: 2500, outputTokens: 150, cacheReadTokens: 2200, uncachedInputTokens: 300, reasoningTokens: 30 });
  });
  it('estimates helper calls by characters and keeps a per-surface tally', () => {
    let a = emptySessionUsage();
    a = addHelperEstimate(a, 8000, 400, 'lift-plan'); a = addHelperEstimate(a, 4000, 200, 'endturn-resolver'); a = addHelperEstimate(a, 4000, 100, 'lift-plan');
    expect(a.helper).toMatchObject({ calls: 3, inputTokensEst: 4000, outputTokensEst: 175 }); expect(a.helper.bySurface['lift-plan']).toBe(2000 + 100 + 1000 + 25);
  });
  it('prices the session and reports the cache-hit rate', () => {
    let a = emptySessionUsage();
    a = addMainUsage(a, { inputTokens: 1_000_000, outputTokens: 100_000, totalTokens: 0, cache: { cacheReadTokens: 900_000 } as any } as any);
    const c = usageCost(a, { inputPerM: 0.14, cacheHitPerM: 0.007, outputPerM: 0.28 });
    expect(c.main).toBeCloseTo(0.1 * 0.14 + 0.9 * 0.007 + 0.1 * 0.28, 6); expect(c.cacheHitRate).toBeCloseTo(0.9, 6); expect(c.helperEst).toBe(0);
  });
});


import { addSubagentUsage, emptySessionUsage as _empty, usageCost as _cost } from '../usageAccounting.js';
describe('subagents bucket (2026-10-01)', () => {
  const child = { requests: 3, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 600, cacheCreationTokens: 0, uncachedInputTokens: 400, reasoningTokens: 50,
    helper: { calls: 1, inputTokensEst: 100, outputTokensEst: 10, bySurface: {} } };
  it('folds the child exact usage into the totals AND the breakdown; helper estimates into the breakdown only', () => {
    const a = addSubagentUsage(_empty(), child as any);
    expect(a.inputTokens).toBe(1000); expect(a.uncachedInputTokens).toBe(400); expect(a.requests).toBe(3);
    expect(a.helper.inputTokensEst).toBe(0);
    expect(a.subagents).toMatchObject({ calls: 1, requests: 3, inputTokens: 1000, outputTokens: 200, helperInputTokensEst: 100, helperOutputTokensEst: 10 });
  });
  it('missing child usage still counts the call; malformed numbers are ignored', () => {
    const a = addSubagentUsage(addSubagentUsage(_empty(), undefined), { inputTokens: -5, outputTokens: NaN } as any);
    expect(a.subagents.calls).toBe(2); expect(a.inputTokens).toBe(0);
  });
  it('usageCost prices sub-agent spend (main via the totals, helper estimates via the breakdown)', () => {
    const p = { inputPerM: 1, cacheHitPerM: 0.1, outputPerM: 2, helperInputPerM: 10, helperOutputPerM: 20 };
    const c = _cost(addSubagentUsage(_empty(), child as any), p);
    expect(c.main).toBeCloseTo((400 * 1 + 600 * 0.1 + 200 * 2) / 1e6, 12);
    expect(c.helperEst).toBeCloseTo((100 * 10 + 10 * 20) / 1e6, 12);
  });
});


import { sumSessionUsage, emptySessionUsage as _e2 } from '../usageAccounting.js';
describe('R239 sumSessionUsage (second-attempt chain)', () => {
  it('adds every numeric counter, merges helper.bySurface by key, sums subagents, keeps the later non-numeric value', () => {
    const a = { ..._e2(), requests: 3, inputTokens: 100, outputTokens: 10, reasoningTokens: 5, helper: { calls: 1, inputTokensEst: 50, outputTokensEst: 5, bySurface: { 'lift-plan': 55, judge: 1 } }, subagents: { ..._e2().subagents, calls: 1, inputTokens: 20 } } as any;
    const b = { ..._e2(), requests: 2, inputTokens: 200, outputTokens: 20, costUsd: 0.01, model: 'm2', helper: { calls: 2, inputTokensEst: 70, outputTokensEst: 7, bySurface: { judge: 2, author: 3 } }, subagents: { ..._e2().subagents, calls: 2, inputTokens: 30 } } as any;
    const s = sumSessionUsage(a, b) as any;
    expect(s).toMatchObject({ requests: 5, inputTokens: 300, outputTokens: 30, reasoningTokens: 5, costUsd: 0.01, model: 'm2' });
    expect(s.helper).toEqual({ calls: 3, inputTokensEst: 120, outputTokensEst: 12, bySurface: { 'lift-plan': 55, judge: 3, author: 3 } });
    expect(s.subagents).toMatchObject({ calls: 3, inputTokens: 50, outputTokens: 0 });
  });
  it('tolerates null, undefined and partial ledgers', () => {
    expect(sumSessionUsage(null, undefined)).toEqual(_e2());
    expect(sumSessionUsage({ inputTokens: 5 } as any, null).inputTokens).toBe(5);
    expect(sumSessionUsage({ inputTokens: 5 } as any, { inputTokens: 7 } as any).helper.calls).toBe(0);
  });
});
