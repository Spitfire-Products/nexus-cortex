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

// ── R137 HB-POLL-REPEAT-BREAKER: poll tools count only on byte-identical STALLED results ──
import { POLL_TOOL_NAMES, isPollResultRunning, notePollResults } from '../loopLadder.js';

d2('ExactRepeatTracker poll exemption (R137 HB-POLL-REPEAT-BREAKER)', () => {
  const pollInput = JSON.stringify({ bash_id: 'bg-8c537679' });
  const running = (n: number) => `Shell ID: bg-8c537679\nPID: 42\nStatus: Running\nCommand: python3 fit.py\nNew Lines: ${n}\n\n=== Output ===\nepoch ${n}\n`;
  const exited = 'Shell ID: bg-8c537679\nPID: 42\nStatus: Exited\nExit Code: 0\nCommand: python3 fit.py\nNew Lines: 0\n\n=== Output ===\n(no new output)';

  it2('exports BashOutput as a poll tool', () => {
    ex2(POLL_TOOL_NAMES.has('BashOutput')).toBe(true);
    ex2(POLL_TOOL_NAMES.has('Bash')).toBe(false);
  });

  it2('isPollResultRunning reads the BashOutput status line and metadata', () => {
    ex2(isPollResultRunning('BashOutput', running(1))).toBe(true);
    ex2(isPollResultRunning('BashOutput', exited)).toBe(false);
    ex2(isPollResultRunning('BashOutput', '(no new output)', { isRunning: true })).toBe(true);
    ex2(isPollResultRunning('Bash', 'Status: Running')).toBe(false);
  });

  it2('(a) 5 identical BashOutput polls with changing results never trip', () => {
    const t = new ExactRepeatTracker();
    let max = 0;
    for (let i = 0; i < 5; i++) {
      max = Math.max(max, t.observe('BashOutput', pollInput));
      t.noteResult('BashOutput', pollInput, running(i));
    }
    ex2(max).toBeLessThan(5);
    ex2(max).toBe(1); // process alive → never counts
  });

  it2('(a2) exited process with CHANGING output still never trips', () => {
    const t = new ExactRepeatTracker();
    let max = 0;
    for (let i = 0; i < 5; i++) {
      max = Math.max(max, t.observe('BashOutput', pollInput));
      t.noteResult('BashOutput', pollInput, `${exited}\nline ${i}`);
    }
    ex2(max).toBeLessThan(5);
  });

  it2('(b) 5 identical BashOutput polls with byte-identical not-running results trip at 5', () => {
    const t = new ExactRepeatTracker();
    let n = 0;
    for (let i = 0; i < 5; i++) {
      n = t.observe('BashOutput', pollInput);
      t.noteResult('BashOutput', pollInput, exited);
    }
    ex2(n).toBe(5);
  });

  it2('(c) 5 identical Bash calls (non-poll) trip at 5 regardless of results', () => {
    const t = new ExactRepeatTracker();
    let n = 0;
    for (let i = 0; i < 5; i++) {
      n = t.observe('Bash', 'same');
      t.noteResult('Bash', 'same', `different output ${i}`);
    }
    ex2(n).toBe(5);
  });

  it2('(d) a poll interleaved between identical Bash calls resets consecutive counting', () => {
    const t = new ExactRepeatTracker();
    ex2(t.observe('Bash', 'same')).toBe(1);
    ex2(t.observe('Bash', 'same')).toBe(2);
    ex2(t.observe('BashOutput', pollInput)).toBe(1);
    t.noteResult('BashOutput', pollInput, exited);
    ex2(t.observe('Bash', 'same')).toBe(1);
    ex2(t.observe('Bash', 'same')).toBe(2);
  });

  it2('notePollResults feeds a batch back by tool_use_id using the observe() input hash', () => {
    const t = new ExactRepeatTracker();
    const input = { bash_id: 'bg-8c537679' };
    let n = 0;
    for (let i = 0; i < 5; i++) {
      n = t.observe('BashOutput', JSON.stringify(input));
      notePollResults(t, [{ id: `u${i}`, name: 'BashOutput', input }], [{ tool_use_id: `u${i}`, tool_name: 'BashOutput', content: '(no new output)', metadata: { isRunning: true } }]);
    }
    ex2(n).toBe(1);
  });

  it2('a poll whose result was never reported falls back to raw consecutive counting', () => {
    const t = new ExactRepeatTracker();
    let n = 0;
    for (let i = 0; i < 5; i++) n = t.observe('BashOutput', pollInput);
    ex2(n).toBe(5);
  });
});

// ── Item 14b: windowed near-dup breaker (outcome-agnostic, interleaving-proof) ──
d2('near-dup breaker (CORTEX_NEARDUP_BREAKER)', () => {
  const prevN = process.env.CORTEX_NEARDUP_BREAKER;
  be2(() => { process.env.CORTEX_NEARDUP_BREAKER = 'true'; delete process.env.CORTEX_POLL_GUARD; });
  ae2(() => { if (prevN === undefined) delete process.env.CORTEX_NEARDUP_BREAKER; else process.env.CORTEX_NEARDUP_BREAKER = prevN; });
  const ok = (h: string) => ({ status: 'ok' as const, approachHash: h });

  it2('the x65 specimen shape: interleaved same-approach polling nudges at 12-in-window', () => {
    const l = new LL2();
    let fired: any = null;
    // poll, work, poll, work … (poll guard blind: never consecutive)
    for (let i = 0; i < 30; i++) {
      const r = i % 2 === 0 ? l.observe('Bash', ok('poll-check')) : l.observe('Bash', ok(`work-${i}`));
      if (r.family === 'neardup' && !fired) fired = r;
    }
    ex2(fired).not.toBeNull();
    ex2(fired.action).toBe('diversify');
    ex2(fired.count).toBeGreaterThanOrEqual(12);
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

describe('HB-LOOP-NEARDUP — similarity lens on executing tools (2026-09-10)', () => {
  const prev = process.env.CORTEX_NEARDUP_BREAKER;
  beforeEach(() => { process.env.CORTEX_NEARDUP_BREAKER = 'true'; delete process.env.CORTEX_POLL_GUARD; delete process.env.NEARDUP_SIM_AT; });
  afterEach(() => { if (prev === undefined) delete process.env.CORTEX_NEARDUP_BREAKER; else process.env.CORTEX_NEARDUP_BREAKER = prev; });
  const bash = (cmd: string, i: number) => ({ status: 'ok' as const, approachHash: `h${i}`, exactHash: `e${i}`, approachText: cmd.replace(/\d+/g, '#') });

  it('the gcode python -c grind: edited-script retries with DIFFERENT hashes cross the similarity rung at 7', () => {
    const l = new LoopLadder();
    const base = 'cd /app && python3 -c " import re, math data = open(\'text.gcode\').read() lines = data.splitlines() pts=[] for ln in lines: if ln.startswith(\'G1\'): pts.append(ln) print(len(pts)) ';
    let fired: any = null;
    for (let i = 0; i < 10; i++) {
      const r = l.observe('Bash', bash(base + ` # v${i} tweak`, i)); // each retry a slightly different script
      if (r.family === 'neardup' && !fired) fired = r;
    }
    expect(fired).not.toBeNull();
    expect(fired.action).toBe('diversify');
    expect(fired.trigger).toBe('similarity');
    expect(fired.count).toBeGreaterThanOrEqual(7);
  });

  it('6 similar runs (healthy test iteration, the schemelike passes) stay silent; 7 fires', () => {
    const l = new LoopLadder();
    const cmd = 'cd /app && python3 interp.py test/calculator.scm';
    for (let i = 0; i < 6; i++) expect(l.observe('Bash', bash(cmd, i)).family).not.toBe('neardup');
    expect(l.observe('Bash', bash(cmd, 6)).action).toBe('diversify');
  });

  it('slice-reads (sed -n paging) never feed the lens — that is the slice block\'s job', () => {
    const l = new LoopLadder();
    for (let i = 0; i < 20; i++) {
      // classifyToolOutcome yields approachText '' for slice-reads; the ladder must treat '' as no text
      expect(l.observe('Bash', { status: 'ok', approachHash: `p${i}`, exactHash: `x${i}`, approachText: '' }).family).not.toBe('neardup');
    }
  });

  it('non-executing tools (Read paging) do not carry approachText and never fire the similarity lens', () => {
    const l = new LoopLadder();
    for (let i = 0; i < 20; i++) expect(l.observe('Read', { status: 'ok', approachHash: 'same', exactHash: `x${i}` }).trigger).not.toBe('similarity');
  });

  it('masking fix: a near-dup diversify is not hidden by a failure-ladder remind on the same call', () => {
    const l = new LoopLadder();
    const cmd = 'cd /app && python3 build.py';
    for (let i = 0; i < 5; i++) l.observe('Bash', bash(cmd, i));
    // 6th similar call FAILS (failure count 1, similarity 6: nothing yet); 7th FAILS again: the failure
    // ladder says remind (2nd fail on its hash) while the similarity lens crosses 7 → diversify must win
    l.observe('Bash', { ...bash(cmd, 99), status: 'failed' });
    const r = l.observe('Bash', { ...bash(cmd, 99), status: 'failed' });
    expect(r.action).toBe('diversify');
    expect(r.family).toBe('neardup');
  });

  it('NEARDUP_SIM_AT tunes the rung', () => {
    process.env.NEARDUP_SIM_AT = '3';
    const l = new LoopLadder();
    const cmd = 'make test';
    l.observe('Bash', bash(cmd, 0)); l.observe('Bash', bash(cmd, 1));
    expect(l.observe('Bash', bash(cmd, 2)).action).toBe('diversify');
  });
});

describe('HB-CHUNKED-READS (R128) — sequential chunk reads of one file are a progression, not a loop', () => {
  const prevN = process.env.CORTEX_NEARDUP_BREAKER, prevP = process.env.CORTEX_POLL_GUARD, prevAt = process.env.NEARDUP_NUDGE_AT;
  beforeEach(() => { process.env.CORTEX_NEARDUP_BREAKER = 'true'; process.env.CORTEX_POLL_GUARD = 'true'; process.env.NEARDUP_NUDGE_AT = '3'; });
  afterEach(() => {
    for (const [k, v] of [['CORTEX_NEARDUP_BREAKER', prevN], ['CORTEX_POLL_GUARD', prevP], ['NEARDUP_NUDGE_AT', prevAt]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  // every chunk collides into ONE digit-stripped approachHash (the real classifyToolOutcome shape)
  const sedChunk = (start: number, end: number) => ({
    status: 'ok' as const, approachHash: 'sed-n-chunk', exactHash: `${start}-${end}`, approachText: '',
    chunkRead: { file: '/app/big.log', start, end, kind: 'sed' as const },
  });

  it('a 6-chunk sed -n progression fires NOTHING (no neardup hash nudge, no poll remind)', () => {
    const l = new LoopLadder();
    for (let i = 0; i < 6; i++) {
      const r = l.observe('Bash', sedChunk(i * 200 + 1, (i + 1) * 200));
      expect(r.action).toBe('none');
    }
  });

  it('a 3x IDENTICAL range on the same file still fires the near-dup hash lens', () => {
    const l = new LoopLadder();
    expect(l.observe('Bash', sedChunk(1, 200)).action).toBe('none');
    expect(l.observe('Bash', sedChunk(1, 200)).action).toBe('none');
    const r = l.observe('Bash', sedChunk(1, 200));
    expect(r.action).toBe('diversify');
    expect(r.family).toBe('neardup');
    expect(r.trigger).toBe('hash');
  });

  it('overlapping / backwards re-reads count as repeats (real loop detection intact)', () => {
    const l = new LoopLadder();
    l.observe('Bash', sedChunk(1, 200));
    l.observe('Bash', sedChunk(150, 350));   // overlap → same key
    expect(l.observe('Bash', sedChunk(1, 200)).action).toBe('diversify'); // backwards → same key, 3-in-window
  });

  it('Read-tool paging (offset/limit) over one file is a progression too', () => {
    const l = new LoopLadder();
    for (let i = 0; i < 6; i++) {
      const start = i * 200 + 1;
      const r = l.observe('Read', { status: 'ok', approachHash: 'read-page', exactHash: `r${i}`, chunkRead: { file: '/app/big.log', start, end: start + 199, kind: 'read' } });
      expect(r.action).toBe('none');
    }
  });
});

// R136 HB-NEARDUP-SCRIPT-SHAPE (2026-09-13): script identity dominates wrapper shape in the
// SIMILARITY lens. Outcomes come from the REAL classifyToolOutcome pipeline (approachText +
// commandIdentity) so the test exercises the production shape, not a hand-fed text.
import { describe as d136, it as it136, expect as ex136, beforeEach as be136, afterEach as ae136 } from 'vitest';
import { LoopLadder as LL136 } from '../loopLadder.js';
import { classifyToolOutcome as classify136 } from '../toolOutcome.js';

d136('R136 HB-NEARDUP-SCRIPT-SHAPE — different scripts under one shell wrapper are not near-duplicates', () => {
  const prev = process.env.CORTEX_NEARDUP_BREAKER;
  be136(() => { process.env.CORTEX_NEARDUP_BREAKER = 'true'; delete process.env.CORTEX_POLL_GUARD; delete process.env.NEARDUP_SIM_AT; delete process.env.NEARDUP_NUDGE_AT; });
  ae136(() => { if (prev === undefined) delete process.env.CORTEX_NEARDUP_BREAKER; else process.env.CORTEX_NEARDUP_BREAKER = prev; });
  const run = (command: string, exitCode = 0) => classify136('Bash', { command }, { content: exitCode ? 'Traceback: boom' : 'ok', metadata: { exitCode } });

  // The mp-checkpoint-consolidation sequence (Terminal-Bench 4.0 validation): 5 different scripts +
  // 4 different inline bodies under ONE `cd /app && timeout 300 python3 -u … 2>&1 | grep …` wrapper.
  // The wrapper's grep filter is the realistic multi-pattern form (the backlog cites `2>&1 | grep -vE …`); with it the
  // five script-file commands score whole-text Dice 0.92-0.98 against each other under the OLD lens (the -c runs 0.82-0.86).
  const W = ' 2>&1 | grep -vE "UserWarning|FutureWarning|DeprecationWarning|warnings.warn"';
  const PRE = "import torch, glob\nsd = torch.load('/app/ckpt/shard0.pt', map_location='cpu')\nprint(len(sd))\n";
  const MP_CHECKPOINT = [
    'cd /app && timeout 300 python3 -u /tmp/search.py 2>/dev/null',
    `cd /app && timeout 300 python3 -u /tmp/unfused.py${W}`,
    `cd /app && timeout 300 python3 -u /tmp/moe_search.py${W}`,
    `cd /app && timeout 300 python3 -u /tmp/grad_diag.py${W}`,
    `cd /app && timeout 300 python3 -u /tmp/fuse_check.py${W}`,
    `cd /app && timeout 300 python3 -u -c "${PRE}for k, v in sd.items():\n    if 'expert' in k: print(k, tuple(v.shape))"${W}`,
    `cd /app && timeout 300 python3 -u -c "${PRE}import numpy as np\nprint({k: float(v.float().norm()) for k, v in sd.items() if v.ndim == 2})"${W}`,
    `cd /app && timeout 300 python3 -u -c "${PRE}keys = sorted(sd.keys())\nprint(keys[:20], len(keys))"${W}`,
    `cd /app && timeout 300 python3 -u -c "${PRE}tot = sum(v.numel() for v in sd.values())\nprint('params', tot, 'GB', tot * 2 / 1e9)"${W}`,
    `cd /app && timeout 300 python3 -u /tmp/search.py --topk 8${W}`,
    `cd /app && timeout 300 python3 -u /tmp/final_merge.py${W}`,
  ];

  it136('the mp-checkpoint sequence fires NO diversify rung and NO neardup-similarity signal', () => {
    const l = new LL136();
    // 16 calls: under the OLD lens the 2nd-pass unfused.py is the 7th wrapper-similar call (diversify, trigger
    // similarity). Bounded below 12 same-approachHash calls: normalizeApproachText collapses every /tmp/X.py into
    // <path>, so the separate neardup-hash lens would fire at 12 — a sibling path, out of scope for R136.
    for (const cmd of [...MP_CHECKPOINT, ...MP_CHECKPOINT.slice(0, 5)]) {
      const r = l.observe('Bash', run(cmd));
      ex136(r.action, cmd).toBe('none');
      ex136(r.trigger).toBeUndefined();
    }
  });

  it136('control: the same script 6x with the same flags and failing output still escalates remind → diversify → break', () => {
    const l = new LL136();
    const cmd = `cd /app && timeout 300 python3 -u /tmp/search.py${W}`;
    const actions = [] as string[];
    for (let i = 0; i < 6; i++) actions.push(l.observe('Bash', run(cmd, 1)).action);
    ex136(actions).toEqual(['none', 'remind', 'remind', 'diversify', 'diversify', 'break']);
  });

  it136('control: the same script re-run 7x with tweaked flags/numbers still crosses the similarity rung', () => {
    const l = new LL136();
    let fired: any = null;
    for (let i = 0; i < 7; i++) {
      const r = l.observe('Bash', run(`cd /app && timeout ${300 + i * 60} python3 -u /tmp/search.py --seed ${i}${W}`));
      if (r.family === 'neardup' && !fired) fired = r;
    }
    ex136(fired).not.toBeNull();
    ex136(fired.trigger).toBe('similarity');
    ex136(fired.action).toBe('diversify');
  });

  // R136b: the neardup-HASH lens + failure ladder key honor script identity too (R128's suffix pattern).
  it136('R136b: 20 different scripts under one wrapper never fire the neardup-hash lens (12-in-30)', () => {
    const l = new LL136();
    for (let i = 0; i < 20; i++) {
      const r = l.observe('Bash', run(`cd /app && timeout 300 python3 -u /tmp/exp_${String.fromCharCode(97 + i)}.py${W}`));
      ex136(r.action, `call ${i}`).toBe('none');
      ex136(r.trigger).toBeUndefined();
    }
  });

  it136('R136b control: the same script 12x still fires the neardup-hash lens at its threshold', () => {
    const l = new LL136();
    let hashFired: any = null;
    for (let i = 0; i < 12; i++) {
      const r = l.observe('Bash', run(`cd /app && timeout 300 python3 -u /tmp/search.py${W}`));
      if (r.trigger === 'hash' && !hashFired) hashFired = { ...r, at: i + 1 };
    }
    ex136(hashFired).not.toBeNull();
    ex136(hashFired.at).toBe(12);
    ex136(hashFired.action).toBe('diversify');
  });

  it136('R136b: commands without identity (ls/grep) keep the plain approachHash key', () => {
    process.env.NEARDUP_NUDGE_AT = '3';
    const l = new LL136();
    l.observe('Bash', run('ls -la /app')); l.observe('Bash', run('ls -la /app'));
    const r = l.observe('Bash', run('ls -la /app'));
    ex136(r.trigger).toBe('hash');
  });

  it136('control: the gcode -c grind (minor edits of one inline body) still crosses the similarity rung', () => {
    const l = new LL136();
    const body = "import re, math; data = open('text.gcode').read(); lines = data.splitlines(); pts = [ln for ln in lines if ln.startswith('G1')]; print(len(pts))";
    let fired: any = null;
    for (let i = 0; i < 8; i++) {
      const r = l.observe('Bash', run(`cd /app && python3 -c "${body} # v${i}"`));
      if (r.family === 'neardup' && !fired) fired = r;
    }
    ex136(fired).not.toBeNull();
    ex136(fired.trigger).toBe('similarity');
  });
});

// R135 HB-POLL-LOOP (2026-09-13): a poll-and-wait (sleep N; read-only probe) is MONITORING, not a stuck
// approach. Ok polls bypass both near-dup lenses and the failure ladder and get a `poll_steer` nudge
// (3rd consecutive same-probe poll, then every 10th); failing polls still climb the failure ladder.
import { describe as d135, it as it135, expect as ex135, beforeEach as be135, afterEach as ae135 } from 'vitest';
import { LoopLadder as LL135, formatLadderSignal as fmt135 } from '../loopLadder.js';
import { classifyToolOutcome as classify135 } from '../toolOutcome.js';

d135('R135 HB-POLL-LOOP — poll-and-wait never feeds the loop lenses; poll_steer instead of block', () => {
  const prev = process.env.CORTEX_NEARDUP_BREAKER;
  be135(() => {
    process.env.CORTEX_NEARDUP_BREAKER = 'true';
    delete process.env.CORTEX_POLL_GUARD;
    process.env.NEARDUP_SIM_AT = '3'; // sensitive lenses: any leak would fire
    process.env.NEARDUP_NUDGE_AT = '3';
  });
  ae135(() => {
    if (prev === undefined) delete process.env.CORTEX_NEARDUP_BREAKER; else process.env.CORTEX_NEARDUP_BREAKER = prev;
    delete process.env.NEARDUP_SIM_AT; delete process.env.NEARDUP_NUDGE_AT;
  });
  const CFG = 'http://localhost:5000/api/v1/config';
  const run = (command: string, exitCode = 0) => classify135('Bash', { command }, { content: exitCode ? 'curl: (7) Failed to connect' : '{"eval_window":3}', metadata: { exitCode } });
  // The ctr-optimization poll sequence: varied waits + pipe consumers, ONE probe.
  const POLLS = [
    `sleep 115; curl -s ${CFG} | python3 -c "import sys,json;print(json.load(sys.stdin)['eval_window'])"`,
    `sleep 130; curl -s ${CFG}`,
    `sleep 115; echo t1; sleep 115; curl -s ${CFG}`,
    `sleep 120; curl -s ${CFG} | python3 -c "import sys,json;print(json.load(sys.stdin)['ctr'])"`,
    `sleep 130; curl -s ${CFG}`,
    `sleep 115; curl -s ${CFG}`,
  ];

  it135('6 ok polls of the same probe: no near-dup trigger, no failure rung, poll_steer at the 3rd', () => {
    const l = new LL135();
    const results = POLLS.map((c) => l.observe('Bash', run(c)));
    ex135(results.some((r) => r.family === 'neardup')).toBe(false);
    ex135(results.some((r) => r.action === 'remind' || r.action === 'diversify' || r.action === 'break')).toBe(false);
    ex135(results.map((r) => r.action)).toEqual(['none', 'none', 'poll_steer', 'none', 'none', 'none']);
    const steer = results[2]!;
    ex135(steer.family).toBe('poll');
    ex135(steer.count).toBe(3);
    ex135(steer.poll?.probe).toContain('localhost:5000/api/v1/config');
    ex135(steer.poll?.waits).toBe(3);
    ex135(steer.poll?.waitSec).toBeGreaterThan(100);
  });

  it135('poll_steer fires again every 10th consecutive poll (3, 10, 20)', () => {
    const l = new LL135();
    const fired: number[] = [];
    for (let i = 1; i <= 20; i++) if (l.observe('Bash', run(POLLS[i % POLLS.length]!)).action === 'poll_steer') fired.push(i);
    ex135(fired).toEqual([3, 10, 20]);
  });

  it135('the same 6 polls with ERROR results still climb the failure ladder (remind 2 / diversify 4 / break 6)', () => {
    delete process.env.NEARDUP_SIM_AT; delete process.env.NEARDUP_NUDGE_AT; // default lenses: the failure ladder is what is under test
    const l = new LL135();
    const same = [`sleep 115; curl -s ${CFG}`, `sleep 130; curl -s ${CFG}`, `sleep 120; curl -s ${CFG}`, `sleep 115; curl -s ${CFG}`, `sleep 130; curl -s ${CFG}`, `sleep 115; curl -s ${CFG}`];
    const actions = same.map((c) => l.observe('Bash', run(c, 7)).action);
    ex135(actions).toEqual(['none', 'remind', 'remind', 'diversify', 'diversify', 'break']);
  });

  it135('a repeated BARE read-only probe (no wait) after the same probe is a poll too', () => {
    const l = new LL135();
    const results = Array.from({ length: 6 }, () => l.observe('Bash', run(`curl -s ${CFG}`)));
    ex135(results.some((r) => r.family === 'neardup')).toBe(false); // would fire at 3 via the hash lens without R135
    ex135(results.some((r) => r.action === 'poll_steer')).toBe(true);
  });

  it135('polls interleaved with real work do not blunt R136/R136b: the grind still crosses its rungs', () => {
    const l = new LL135();
    const body = "import re, math; data = open('text.gcode').read(); lines = data.splitlines(); pts = [ln for ln in lines if ln.startswith('G1')]; print(len(pts))";
    let sim: any = null;
    for (let i = 0; i < 6; i++) {
      l.observe('Bash', run(`sleep 30; curl -s ${CFG}`));
      const r = l.observe('Bash', run(`cd /app && python3 -c "${body} # v${i}"`));
      if (r.family === 'neardup' && !sim) sim = r;
    }
    ex135(sim).not.toBeNull();
    ex135(sim.trigger).toBe('similarity');
    delete process.env.NEARDUP_SIM_AT; // hash-lens half (as R136b): at a rank tie the similarity lens would win the trigger label
    const l2 = new LL135();
    let hash: any = null;
    for (let i = 0; i < 4; i++) {
      l2.observe('Bash', run(`sleep 30; curl -s ${CFG}`));
      const r = l2.observe('Bash', run('ls -la /app'));
      if (r.trigger === 'hash' && !hash) hash = r;
    }
    ex135(hash).not.toBeNull();
  });

  it135('formatLadderSignal renders the poll_steer text (background + BashOutput, Bash stays available)', () => {
    const text = fmt135('Bash', { action: 'poll_steer', count: 3, family: 'poll', poll: { probe: 'curl localhost:5000/api/v1/config', waits: 3, waitSec: 120 } });
    ex135(text).toContain('Polling pattern detected (3 waits of ~120 s on curl localhost:5000/api/v1/config)');
    ex135(text).toContain('run_in_background');
    ex135(text).toContain('BashOutput');
    // R142 HB-WAIT-PRIMITIVE: the steer names the side-effect-free wait instead of sleep polling.
    ex135(text).toContain('wait_seconds');
    ex135(text).toContain('wait_for');
    ex135(text).toContain('Bash stays available');
  });
});

// R135b (2026-09-13): a Bash POLL (outcome.poll.isPoll) is exempt from the exact-repeat killer like BashOutput —
// byte-identical polls count toward MAX_LOOP_REPETITIONS only when the RESULT is byte-identical to the previous
// poll's result (a changing probe result is progress). Non-poll Bash keeps the plain consecutive count.
import { describe as d135b, it as it135b, expect as ex135b } from 'vitest';
import { ExactRepeatTracker as ERT135b, notePollResults as note135b } from '../loopLadder.js';

d135b('ExactRepeatTracker Bash poll exemption (R135b)', () => {
  const poll = { command: 'sleep 115; curl -s http://localhost:5000/api/v1/config' };
  const pollInput = JSON.stringify(poll);

  it135b('6 identical polls with CHANGING results never trip', () => {
    const t = new ERT135b();
    let max = 0;
    for (let i = 0; i < 6; i++) {
      max = Math.max(max, t.observe('Bash', pollInput, { isPoll: true }));
      t.noteResult('Bash', pollInput, `{"eval_window":${i}}`);
    }
    ex135b(max).toBeLessThan(6);
    ex135b(max).toBeLessThanOrEqual(2);
  });

  it135b('6 identical polls with byte-identical results trip at 6', () => {
    const t = new ERT135b();
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = t.observe('Bash', pollInput, { isPoll: true });
      t.noteResult('Bash', pollInput, '{"eval_window":3}');
    }
    ex135b(last).toBe(6);
  });

  it135b('6 identical NON-poll Bash commands trip as before (no result consultation)', () => {
    const t = new ERT135b();
    const input = JSON.stringify({ command: 'python3 train.py' });
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = t.observe('Bash', input);
      t.noteResult('Bash', input, `epoch ${i}`); // ignored for non-poll Bash
    }
    ex135b(last).toBe(6);
  });

  it135b('notePollResults feeds Bash poll results through the orchestrator glue', () => {
    const t = new ERT135b();
    let max = 0;
    for (let i = 0; i < 6; i++) {
      max = Math.max(max, t.observe('Bash', pollInput, { isPoll: true }));
      note135b(t, [{ id: `u${i}`, name: 'Bash', input: poll }], [{ tool_use_id: `u${i}`, tool_name: 'Bash', content: `tick ${i}` }]);
    }
    ex135b(max).toBeLessThanOrEqual(2);
  });
});
