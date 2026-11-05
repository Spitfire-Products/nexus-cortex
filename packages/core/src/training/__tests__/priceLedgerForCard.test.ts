import { describe, it, expect } from 'vitest';
import { emptySessionUsage, priceLedgerForCard } from '../usageAccounting.js';

describe('priceLedgerForCard', () => {
  it('prices the exact ledger at the card rates (cached input at its own rate)', () => {
    const u = { ...emptySessionUsage(), requests: 3, inputTokens: 1_200_000, uncachedInputTokens: 200_000, cacheReadTokens: 1_000_000, outputTokens: 100_000 };
    const r = priceLedgerForCard(u as any, { inputPerMillion: 3, cachedInputPerMillion: 0.3, outputPerMillion: 15 });
    expect(r.inputTokens).toBe(1_200_000); expect(r.outputTokens).toBe(100_000); expect(r.cacheReadTokens).toBe(1_000_000);
    expect(r.estimatedCost).toBeCloseTo(0.6 + 0.3 + 1.5, 6);   // 0.2M×3 + 1M×0.3 + 0.1M×15
  });
  it('a card without prices costs 0 rather than throwing', () => {
    expect(priceLedgerForCard({ ...emptySessionUsage(), inputTokens: 10, outputTokens: 5 } as any, null).estimatedCost).toBe(0);
  });
});
