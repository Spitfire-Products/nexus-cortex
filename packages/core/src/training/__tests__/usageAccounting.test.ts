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
