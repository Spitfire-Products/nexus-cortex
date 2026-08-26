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

// ── Poll guard (run3 busy-wait deficiency class; CORTEX_POLL_GUARD) ──
import { describe as d2, it as it2, expect as ex2, beforeEach as be2, afterEach as ae2 } from 'vitest';
import { LoopLadder as LL2, formatLadderSignal as fmt2 } from '../loopLadder.js';

d2('poll guard (busy-wait detection on SUCCEEDING repeats)', () => {
  const prev = process.env.CORTEX_POLL_GUARD;
  be2(() => { process.env.CORTEX_POLL_GUARD = 'true'; });
  ae2(() => { if (prev === undefined) delete process.env.CORTEX_POLL_GUARD; else process.env.CORTEX_POLL_GUARD = prev; });

  const ok = (hash: string) => ({ status: 'ok' as const, approachHash: hash });

  it2('nudges ONCE at the 4th consecutive identical succeeding call', () => {
    const l = new LL2();
    ex2(l.observe('Bash', ok('h1')).action).toBe('none');
    ex2(l.observe('Bash', ok('h1')).action).toBe('none');
    ex2(l.observe('Bash', ok('h1')).action).toBe('none');
    const r = l.observe('Bash', ok('h1'));
    ex2(r.action).toBe('remind');
    ex2(r.family).toBe('poll');
    // once per streak — 5th repeat stays quiet
    ex2(l.observe('Bash', ok('h1')).action).toBe('none');
  });

  it2('a different call resets the streak; failures reset it too', () => {
    const l = new LL2();
    l.observe('Bash', ok('h1')); l.observe('Bash', ok('h1')); l.observe('Bash', ok('h1'));
    ex2(l.observe('Bash', ok('h2')).action).toBe('none'); // reset by different approach
    l.observe('Bash', ok('h2')); l.observe('Bash', ok('h2'));
    ex2(l.observe('Bash', ok('h2')).action).toBe('remind');
    // failure resets
    const l3 = new LL2();
    l3.observe('Bash', ok('h1')); l3.observe('Bash', ok('h1')); l3.observe('Bash', ok('h1'));
    l3.observe('Bash', { status: 'failed', approachHash: 'h1' } as any);
    ex2(l3.observe('Bash', ok('h1')).action).toBe('none'); // streak restarted at 1
  });

  it2('default-off: no nudges when env unset', () => {
    delete process.env.CORTEX_POLL_GUARD;
    const l = new LL2();
    for (let i = 0; i < 8; i++) ex2(l.observe('Bash', ok('h1')).action).toBe('none');
  });

  it2('poll remind carries its own injected signal text', () => {
    const sig = fmt2('Bash', { action: 'remind', count: 4, family: 'poll' });
    ex2(sig).toContain('BUSY-WAIT');
    ex2(sig).toContain('4 times');
    // failure-remind (no family) still injects nothing (existing channel)
    ex2(fmt2('Bash', { action: 'remind', count: 2 })).toBeNull();
  });
});

// ── ExactRepeatTracker (consecutive-only MAX_LOOP_REPETITIONS semantics) ──
import { ExactRepeatTracker } from '../loopLadder.js';

d2('ExactRepeatTracker (consecutive-only hard-kill semantics)', () => {
  it2('counts consecutive identical calls', () => {
    const t = new ExactRepeatTracker();
    ex2(t.observe('Bash', 'h1')).toBe(1);
    ex2(t.observe('Bash', 'h1')).toBe(2);
    ex2(t.observe('Bash', 'h1')).toBe(3);
  });

  it2('ANY different call resets — scattered legitimate repeats never accumulate', () => {
    const t = new ExactRepeatTracker();
    // npm test after each of four fixes: test, edit, test, edit, test, edit, test, edit, test
    for (let i = 0; i < 4; i++) {
      ex2(t.observe('Bash', 'npm-test')).toBe(1); // never exceeds 1
      t.observe('Edit', `fix-${i}`);
    }
    ex2(t.observe('Bash', 'npm-test')).toBe(1); // 5th scattered run: still 1, no kill
  });

  it2('true spam (uninterrupted identical) still reaches the kill threshold', () => {
    const t = new ExactRepeatTracker();
    let n = 0;
    for (let i = 0; i < 5; i++) n = t.observe('Bash', 'same');
    ex2(n).toBe(5);
  });

  it2('same input on a different tool is a different key', () => {
    const t = new ExactRepeatTracker();
    t.observe('Bash', 'x'); t.observe('Bash', 'x');
    ex2(t.observe('Grep', 'x')).toBe(1);
  });
});

// ── Item 14b: windowed near-dup breaker (outcome-agnostic, interleaving-proof) ──
d2('near-dup breaker (CORTEX_NEARDUP_BREAKER)', () => {
  const prevN = process.env.CORTEX_NEARDUP_BREAKER;
  be2(() => { process.env.CORTEX_NEARDUP_BREAKER = 'true'; delete process.env.CORTEX_POLL_GUARD; });
  ae2(() => { if (prevN === undefined) delete process.env.CORTEX_NEARDUP_BREAKER; else process.env.CORTEX_NEARDUP_BREAKER = prevN; });
  const ok = (h: string) => ({ status: 'ok' as const, approachHash: h });

  it2('the x65 specimen shape: interleaved same-approach polling nudges at 8-in-window', () => {
    const l = new LL2();
    let fired: any = null;
    // poll, work, poll, work … (poll guard blind: never consecutive)
    for (let i = 0; i < 20; i++) {
      const r = i % 2 === 0 ? l.observe('Bash', ok('poll-check')) : l.observe('Bash', ok(`work-${i}`));
      if (r.family === 'neardup' && !fired) fired = r;
    }
    ex2(fired).not.toBeNull();
    ex2(fired.action).toBe('diversify');
    ex2(fired.count).toBeGreaterThanOrEqual(8);
  });

  it2('sustained recurrence after the nudge escalates to break at 2N', () => {
    const l = new LL2();
    let last: any = { action: 'none' };
    for (let i = 0; i < 40; i++) {
      const r = l.observe('Bash', ok('same-wait-loop'));
      if (r.family === 'neardup') last = r;
    }
    ex2(last.action).toBe('break');
  });

  it2('legitimate varied work never fires', () => {
    const l = new LL2();
    for (let i = 0; i < 40; i++) {
      ex2(l.observe('Bash', ok(`distinct-${i}`)).family).not.toBe('neardup');
    }
  });

  it2('scattered legit repeats (5 test runs across long work) stay silent', () => {
    const l = new LL2();
    let fired = false;
    for (let block = 0; block < 5; block++) {
      if (l.observe('Bash', ok('npm-test')).family === 'neardup') fired = true;
      for (let j = 0; j < 6; j++) l.observe('Edit', ok(`fix-${block}-${j}`));
    }
    ex2(fired).toBe(false); // window slides past each test run
  });

  it2('default-off: env unset means never fires', () => {
    delete process.env.CORTEX_NEARDUP_BREAKER;
    const l = new LL2();
    for (let i = 0; i < 40; i++) ex2(l.observe('Bash', ok('same')).family).not.toBe('neardup');
  });

  it2('failure-ladder signals take precedence over neardup', () => {
    const l = new LL2();
    for (let i = 0; i < 7; i++) l.observe('Bash', ok('x'));
    // 8th same-key call FAILS twice → remind (failure ladder) wins over neardup diversify
    const r1 = l.observe('Bash', { status: 'failed', approachHash: 'x' } as any);
    const r2 = l.observe('Bash', { status: 'failed', approachHash: 'x' } as any);
    ex2(r2.action).toBe('remind');
    ex2(r2.family).not.toBe('neardup');
  });
});
