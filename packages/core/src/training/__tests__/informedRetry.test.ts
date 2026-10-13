import { describe, it, expect } from 'vitest';
import { buildPriorAttemptsBlock, appendTurnText, PRIOR_ATTEMPTS_HEADER } from '../informedRetry.js';

describe('R254 informed retry (prior attempts block)', () => {
  it('renders every prior attempt with verdict, open items, reading and final message, plus the instruction to question the shared reading', () => {
    const b = buildPriorAttemptsBlock([
      { k: 2, action: null, gapNotes: '', liftPlan: '', finalText: '', turns: null },
      { k: 1, action: 'accept-with-gap', confidence: 'high', gapNotes: '1. transcript mismatch', liftPlan: 'PLAN: use XM_1', finalText: 'done with XM_1', turns: 120 },
    ]);
    expect(b).toContain(`${PRIOR_ATTEMPTS_HEADER} (2)`); expect(b).toContain('the workspace was reset');
    expect(b.indexOf('--- prior attempt 1 ---')).toBeLessThan(b.indexOf('--- prior attempt 2 ---'));
    expect(b).toContain('verdict: accept-with-gap (confidence high) | tool-call turns: 120');
    expect(b).toContain('open items at its finish (verify these):\n1. transcript mismatch');
    expect(b).toContain('its reading of the task (plan of attack):\nPLAN: use XM_1'); expect(b).toContain('its final message:\ndone with XM_1');
    expect(b).toContain('verdict: none'); expect(b.endsWith('=== END PRIOR ATTEMPTS ===')).toBe(true);
    const a2 = b.slice(b.indexOf('--- prior attempt 2 ---')); expect(a2).not.toContain('open items'); expect(a2).not.toContain('final message');
  });
  it('clips long fields instead of dropping them', () => {
    const b = buildPriorAttemptsBlock([{ k: 1, action: 'accept', gapNotes: 'g'.repeat(9000), liftPlan: 'p'.repeat(9000), finalText: 'f'.repeat(9000), turns: 1 }]);
    expect(b.length).toBeLessThan(5500); expect(b).toContain('chars elided');
  });
  it('appends to a string turn or as a text block to a content array; other shapes pass through', () => {
    expect(appendTurnText('task', 'BLOCK')).toBe('task\n\nBLOCK');
    expect(appendTurnText([{ type: 'text', text: 'task' }], 'BLOCK')).toEqual([{ type: 'text', text: 'task' }, { type: 'text', text: 'BLOCK' }]);
    expect(appendTurnText(42 as any, 'BLOCK')).toBe(42);
  });
});
