import { describe, it, expect } from 'vitest';
import { resolveCompactionTargetPct, resolveCompactionTargetTokens } from '../compactionTarget.js';

describe('R256 compaction hysteresis target', () => {
  it('defaults to half the threshold, never above availableForHistory, never below 100', () => {
    expect(resolveCompactionTargetTokens(469_957, 626_609, {})).toBe(234_978);
    expect(resolveCompactionTargetTokens(469_957, 200_000, {})).toBe(200_000);
    expect(resolveCompactionTargetTokens(50, 10, {})).toBe(100);
  });
  it('CORTEX_COMPACTION_TARGET_PCT parses and clamps to [0.1, 1]; junk/0/negative → 0.5', () => {
    expect(resolveCompactionTargetPct({ CORTEX_COMPACTION_TARGET_PCT: '0.6' })).toBe(0.6);
    expect(resolveCompactionTargetPct({ CORTEX_COMPACTION_TARGET_PCT: '5' })).toBe(1);
    expect(resolveCompactionTargetPct({ CORTEX_COMPACTION_TARGET_PCT: '0.01' })).toBe(0.1);
    expect(resolveCompactionTargetPct({ CORTEX_COMPACTION_TARGET_PCT: 'abc' })).toBe(0.5);
    expect(resolveCompactionTargetPct({ CORTEX_COMPACTION_TARGET_PCT: '0' })).toBe(0.5);
    expect(resolveCompactionTargetTokens(400_000, 600_000, { CORTEX_COMPACTION_TARGET_PCT: '0.8' })).toBe(320_000);
  });
  it('the payments thrash shape: at the old target the kept set stays above the threshold; at the new one it does not', () => {
    const threshold = 469_957, available = 626_609, context = 502_608;
    expect(available).toBeGreaterThan(context); // old behaviour: nothing forced below the trigger
    expect(resolveCompactionTargetTokens(threshold, available, {})).toBeLessThan(threshold);
  });
});
