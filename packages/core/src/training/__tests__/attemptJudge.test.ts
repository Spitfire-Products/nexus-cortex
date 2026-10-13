import { describe, it, expect } from 'vitest';
import { buildAttemptJudgePrompt, parseAttemptJudgeRanking, applyJudgeRanking, ATTEMPT_JUDGE_SYSTEM, type AttemptPacket } from '../attemptJudge.js';

const pk = (k: number, o: Partial<AttemptPacket> = {}): AttemptPacket => ({ k, liftPlan: `plan ${k}`, action: 'accept-with-gap', confidence: 'medium', namedPassed: 1, gapNotes: `item ${k}`, check: 'none', checkOutput: '', diffStat: ` a${k}.txt | 1 +`, finalText: `done ${k}`, turns: 10 + k, ...o });

describe('R251 attempt judge (comparative selector)', () => {
  it('prompt carries every packet section in attempt order and the ranking instruction', () => {
    const p = buildAttemptJudgePrompt('TASK TEXT', [pk(2, { check: 'pass', checkOutput: 'ok' }), pk(1, { liftPlan: '', gapNotes: '' })]);
    expect(p.indexOf('=== ATTEMPT 1 ===')).toBeLessThan(p.indexOf('=== ATTEMPT 2 ==='));
    expect(p).toContain('TASK:\nTASK TEXT');
    expect(p).toContain('RESOLVER OPEN ITEMS');
    expect(p).toContain('SHIPPED CHECK (the workspace\'s own test entry point, run by the harness on this attempt\'s tree): pass\nok');
    expect(p).toContain('a2.txt | 1 +');
    expect(p).toContain('Rank attempts 1, 2');
    expect(ATTEMPT_JUDGE_SYSTEM).toContain('RANKING:');
    expect(p).not.toContain('judge checks passed'); // R253
    // attempt 1 had no plan / no gap notes → those sections are absent for it
    const a1 = p.slice(p.indexOf('=== ATTEMPT 1 ==='), p.indexOf('=== ATTEMPT 2 ==='));
    expect(a1).not.toContain('PLAN OF ATTACK'); expect(a1).not.toContain('OPEN ITEMS');
  });
  it('clips long fields instead of dropping them', () => {
    const p = buildAttemptJudgePrompt('t', [pk(1, { finalText: 'x'.repeat(10_000) })]);
    expect(p).toContain('chars of the final message elided'); expect(p.length).toBeLessThan(6000);
  });
  it('parses a ranking, drops unknown/duplicate attempts, appends the unranked, reads the reason', () => {
    const r = parseAttemptJudgeRanking('RANKING: 3, 9, 3, 1\nREASON: attempt 3 passed the check', [1, 2, 3]);
    expect(r).toEqual({ ranking: [3, 1, 2], reason: 'attempt 3 passed the check', parsed: true });
    expect(parseAttemptJudgeRanking('I think 2 is best', [1, 2]).parsed).toBe(false);
    expect(parseAttemptJudgeRanking('', [1, 2])).toEqual({ ranking: [1, 2], reason: '', parsed: false });
    expect(parseAttemptJudgeRanking('ranking: 2 > 1', [1, 2]).ranking).toEqual([2, 1]);
  });
  it('applies the ranking under the hard shipped-check gate and falls back to the evidence pick', () => {
    const c = [{ k: 1, check: 'fail' as const }, { k: 2, check: 'pass' as const }, { k: 3, check: 'pass' as const }];
    expect(applyJudgeRanking({ candidates: c, ranking: [1, 3, 2], fallbackPick: 2 })).toEqual({ pick: 3, why: 'shipped check passes only on attempt 2,3; judge ranking 1 > 3 > 2 (attempt 3)' });
    expect(applyJudgeRanking({ candidates: c.map((x) => ({ ...x, check: 'none' as const })), ranking: [1, 3, 2], fallbackPick: 2 }).pick).toBe(1);
    expect(applyJudgeRanking({ candidates: c, ranking: [], fallbackPick: 2 })).toEqual({ pick: 2, why: 'judge ranking named no eligible attempt; evidence order' });
  });
  it('R253: the evidence-order prior is stated, the named-check count is never rendered, the system prompt forbids hold-history as a criterion', () => {
    const p = buildAttemptJudgePrompt('t', [pk(1, { namedPassed: 5 }), pk(2, { action: 'accept', namedPassed: 0 })], { priorPick: 2 });
    expect(p).toContain('EVIDENCE-ORDER PRIOR: attempt 2');
    expect(p).not.toContain('judge checks passed'); expect(p).not.toContain('5');
    expect(buildAttemptJudgePrompt('t', [pk(1)])).not.toContain('EVIDENCE-ORDER PRIOR');
    expect(ATTEMPT_JUDGE_SYSTEM).toContain('by construction'); expect(ATTEMPT_JUDGE_SYSTEM).toContain('EVIDENCE-ORDER PRIOR');
    expect(ATTEMPT_JUDGE_SYSTEM).toMatch(/NEVER rank by how much adjudication history/);
  });
});
