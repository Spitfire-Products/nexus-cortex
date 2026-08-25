/**
 * Unified Outcome Ladder — layer 2: the escalation ladder.
 * Per (tool, approachHash): failed repeats escalate remind(2) → diversify(4)
 * → break(6); ok results reset the rung; thresholds env-tunable.
 * (docs/UNIFIED_OUTCOME_LADDER.md — replaces the blunt exact-match turn-kill.)
 */
import { describe, it, expect } from 'vitest';
import { LoopLadder } from '../loopLadder.js';

const failed = { status: 'failed' as const, family: 'e: unable to locate package <q>', approachHash: 'A', exactHash: 'x1' };
const ok = { status: 'ok' as const, approachHash: 'A', exactHash: 'x2' };

describe('LoopLadder escalation', () => {
  it('stays quiet on first failure, reminds at 2, diversifies at 4, breaks at 6', () => {
    const l = new LoopLadder();
    expect(l.observe('Bash', failed).action).toBe('none');       // 1st
    expect(l.observe('Bash', failed).action).toBe('remind');     // 2nd
    expect(l.observe('Bash', failed).action).toBe('remind');     // 3rd
    expect(l.observe('Bash', failed).action).toBe('diversify');  // 4th
    expect(l.observe('Bash', failed).action).toBe('diversify');  // 5th
    expect(l.observe('Bash', failed).action).toBe('break');      // 6th
  });

  it('an ok on the same approach RESETS the rung', () => {
    const l = new LoopLadder();
    l.observe('Bash', failed); l.observe('Bash', failed);        // at remind
    l.observe('Bash', ok);
    expect(l.observe('Bash', failed).action).toBe('none');       // back to 1st
  });

  it('different approaches escalate independently', () => {
    const l = new LoopLadder();
    l.observe('Bash', failed); l.observe('Bash', failed);
    const other = { ...failed, approachHash: 'B' };
    expect(l.observe('Bash', other).action).toBe('none');
  });

  it('errors count toward escalation like failures', () => {
    const l = new LoopLadder();
    const err = { ...failed, status: 'error' as const };
    l.observe('Bash', err);
    expect(l.observe('Bash', err).action).toBe('remind');
  });

  it('thresholds are env-tunable (LOOP_REMIND_AT / LOOP_DIVERSIFY_AT / LOOP_BREAK_AT)', () => {
    const l = new LoopLadder({ remindAt: 1, diversifyAt: 2, breakAt: 3 });
    expect(l.observe('Bash', failed).action).toBe('remind');
    expect(l.observe('Bash', failed).action).toBe('diversify');
    expect(l.observe('Bash', failed).action).toBe('break');
  });

  it('escalation result carries count + family for reminder/record text', () => {
    const l = new LoopLadder();
    l.observe('Bash', failed);
    const r = l.observe('Bash', failed);
    expect(r.count).toBe(2);
    expect(r.family).toBe(failed.family);
  });

  it('break is sticky per approach: further failures keep advising break', () => {
    const l = new LoopLadder({ remindAt: 1, diversifyAt: 2, breakAt: 3 });
    l.observe('Bash', failed); l.observe('Bash', failed); l.observe('Bash', failed);
    expect(l.observe('Bash', failed).action).toBe('break');
  });
});

describe('formatLadderSignal', () => {
  it('is null for none and remind (existing reminders cover remind)', async () => {
    const { formatLadderSignal } = await import('../loopLadder.js');
    expect(formatLadderSignal('Bash', { action: 'none', count: 1 })).toBeNull();
    expect(formatLadderSignal('Bash', { action: 'remind', count: 2 })).toBeNull();
  });
  it('diversify names the tool, count, family and points at skills', async () => {
    const { formatLadderSignal } = await import('../loopLadder.js');
    const s = formatLadderSignal('Bash', { action: 'diversify', count: 4, family: 'e: unable to locate package <q>' });
    expect(s).toContain('4');
    expect(s).toContain('Bash');
    expect(s).toContain('different');
    expect(s?.toLowerCase()).toContain('skill');
  });
  it('break instructs honest final synthesis', async () => {
    const { formatLadderSignal } = await import('../loopLadder.js');
    const s = formatLadderSignal('Bash', { action: 'break', count: 6 });
    expect(s?.toLowerCase()).toMatch(/summar|conclude|final/);
  });
});
