/** R257 — the compaction budget reserves the EFFECTIVE output cap, not the card's maximum (4.124.78). */
import { describe, it, expect } from 'vitest';
import { ContextBudgetManager } from '../ContextBudgetManager.js';

const card: any = {
  id: 'deepseek-flash', provider: 'deepseek',
  limits: { contextWindow: 1_000_000, outputTokens: 393_216 },
  compaction: { thresholdCalculation: { method: 'percentage', percentage: 0.8, safetyMargin: 0 }, behavior: { compactOlder: true } },
};

describe('R257 output reserve = effective cap', () => {
  const m = new ContextBudgetManager();
  it('without a cap the card maximum is reserved (the 10-05..10-13 behaviour: threshold ~470 K on a 1 M window)', () => {
    const b = m.calculateBudget(card, { actualToolTokens: 19_338, actualSystemTokens: 0 });
    expect(b.reservedForOutput).toBe(393_216);
    expect(m.getCompactionThreshold(card, { actualToolTokens: 19_338, actualSystemTokens: 0 })).toBe(Math.floor((1_000_000 - 393_216 - 19_338) * 0.8));
  });
  it('with CORTEX_OUTPUT_CAP_TOKENS=65536 passed as outputTokensCap the reserve shrinks and the threshold rises to ~730 K', () => {
    const o = { actualToolTokens: 19_338, actualSystemTokens: 0, outputTokensCap: 65_536 };
    expect(m.calculateBudget(card, o).reservedForOutput).toBe(65_536);
    const t = m.getCompactionThreshold(card, o);
    expect(t).toBe(Math.floor((1_000_000 - 65_536 - 19_338) * 0.8)); expect(t).toBeGreaterThan(730_000);
  });
  it('a cap above the card maximum never raises the reserve; 0/undefined = card', () => {
    expect(m.calculateBudget(card, { actualToolTokens: 0, outputTokensCap: 999_999 }).reservedForOutput).toBe(393_216);
    expect(m.calculateBudget(card, { actualToolTokens: 0, outputTokensCap: 0 }).reservedForOutput).toBe(393_216);
  });
});
