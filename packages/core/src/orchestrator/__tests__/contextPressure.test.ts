import { describe, it, expect } from 'vitest';
import { resolveToolResultPruneGate, pruneGateTokens, CompactionThrashTracker } from '../contextPressure.js';
import { RESUME_MEMORY_PROMPT } from '../compactionResumeTemplate.js';

describe('R258 tool-result prune gate', () => {
  it('defaults: 0.5 of the compaction threshold, keep 3 turns, hard-clear at age 10; window is the fallback base', () => {
    const g = resolveToolResultPruneGate({});
    expect(g).toEqual({ atFraction: 0.5, keepLastNTurns: 3, hardClearAgeTurns: 10 });
    expect(pruneGateTokens(g, 732_000, 1_000_000)).toBe(366_000); // R257 threshold → prune from 366 K
    expect(pruneGateTokens(g, undefined, 1_000_000)).toBe(500_000); // the pre-R258 behaviour when no threshold is known
  });
  it('levers parse and clamp; junk → defaults', () => {
    expect(resolveToolResultPruneGate({ CORTEX_TOOL_RESULT_PRUNE_AT: '0.3', CORTEX_TOOL_RESULT_PRUNE_KEEP_TURNS: '5', CORTEX_TOOL_RESULT_PRUNE_HARD_AGE: '20' })).toEqual({ atFraction: 0.3, keepLastNTurns: 5, hardClearAgeTurns: 20 });
    expect(resolveToolResultPruneGate({ CORTEX_TOOL_RESULT_PRUNE_AT: '9', CORTEX_TOOL_RESULT_PRUNE_KEEP_TURNS: '0', CORTEX_TOOL_RESULT_PRUNE_HARD_AGE: '1' })).toEqual({ atFraction: 1.5, keepLastNTurns: 3, hardClearAgeTurns: 10 });
    expect(resolveToolResultPruneGate({ CORTEX_TOOL_RESULT_PRUNE_AT: 'x' }).atFraction).toBe(0.5);
  });
});

describe('R258 compaction thrash tracker (Claude Code rule: refilled within 3 turns, 3 times in a row)', () => {
  it('trips on the third rapid refill and resets; slow compactions never trip', () => {
    const t = new CompactionThrashTracker();
    expect(t.record(10)).toBe(false); expect(t.record(12)).toBe(false); expect(t.record(14)).toBe(false); // streak 2
    expect(t.record(16)).toBe(true); // streak 3 → trip
    expect(t.streak).toBe(0);
    expect(t.record(40)).toBe(false); expect(t.record(80)).toBe(false); expect(t.record(120)).toBe(false); expect(t.record(160)).toBe(false);
  });
  it("payments' shape (every turn for 57 turns) trips repeatedly", () => {
    const t = new CompactionThrashTracker(); let trips = 0;
    for (let turn = 100; turn < 157; turn++) if (t.record(turn)) trips++;
    expect(trips).toBeGreaterThanOrEqual(14);
  });
});

describe('R258 resume template carries errors-and-fixes and code snippets (Claude Code summary sections)', () => {
  it('names them', () => {
    expect(RESUME_MEMORY_PROMPT).toContain('ERRORS and FIXES');
    expect(RESUME_MEMORY_PROMPT).toContain('code snippets');
  });
});
