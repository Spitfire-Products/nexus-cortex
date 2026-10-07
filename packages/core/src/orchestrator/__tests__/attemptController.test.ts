/**
 * R239 / P4 — the second-attempt chain's pure functions, table-tested as a 1:1 port of the bench adapter's
 * tests/test_second_attempt_chain.py + tests/test_chain_widening.py (commit 2bd888751). Every case below mirrors one assert there;
 * the two must agree before the adapter copy is deleted (the A/B parity oracle).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveSecondAttemptConfig, decideNextAttempt, selectAttempt, mergeAttemptResponses, detectShippedCheck, runShippedCheck,
  countSessionToolTurns, rankVerdict, type AttemptRecord, type SecondAttemptConfig,
} from '../attemptController.js';

const MIN = 60_000;
const DL = 240 * MIN; // original deadline: 4 h
const T0 = 1_000_000_000;

function cfg(over: Partial<Record<string, string>> = {}): SecondAttemptConfig {
  return resolveSecondAttemptConfig({ CORTEX_SECOND_ATTEMPT: '1', ...over } as NodeJS.ProcessEnv);
}
function go(k: number, act: string | null, elapsedMin: number, o: { mx?: string; ev?: number | null; t0?: number | null; dl?: number; env?: Record<string, string> } = {}) {
  const c = cfg({ ...(o.mx !== undefined ? { CORTEX_SECOND_ATTEMPT_MAX: o.mx } : {}), ...(o.env ?? {}) });
  const t0 = o.t0 === undefined ? T0 : o.t0;
  return decideNextAttempt({ k, action: act, eventRemainingFrac: o.ev ?? null, namedPassed: 1, t0Ms: t0, deadlineMs: o.dl ?? DL, nowMs: (t0 ?? T0) + elapsedMin * MIN, cfg: c });
}

describe('resolveSecondAttemptConfig (lever parsing, adapter parity)', () => {
  it('is off by default and parses every lever like the adapter', () => {
    expect(resolveSecondAttemptConfig({} as any).enabled).toBe(false);
    const c = cfg({ CORTEX_SECOND_ATTEMPT_MAX: '3', CORTEX_SECOND_ATTEMPT_MIN_REMAINING: '0.8', CORTEX_SECOND_ATTEMPT_TRIGGER: ' accept , none ' });
    expect(c).toMatchObject({ enabled: true, max: 3, minRemaining: 0.8, trigger: ['accept', 'none'], reserveMs: 300_000, floorMs: 900_000, outDir: null });
    expect(cfg().trigger).toEqual(['accept-with-gap', 'accept-low-confidence']);
    // 0 = no extra attempts; junk = 1; junk min = 0.5
    expect(cfg({ CORTEX_SECOND_ATTEMPT_MAX: '0' }).max).toBe(0);
    expect(cfg({ CORTEX_SECOND_ATTEMPT_MAX: 'x' }).max).toBe(1);
    expect(cfg({ CORTEX_SECOND_ATTEMPT_MIN_REMAINING: 'abc' }).minRemaining).toBe(0.5);
    expect(cfg({ CORTEX_SECOND_ATTEMPT_OUT_DIR: '/logs/agent' }).outDir).toBe('/logs/agent');
  });
});

describe('decideNextAttempt (sa_go parity)', () => {
  it('MAX unset (= 1): exactly one extra attempt — attempt 1 continues, attempt 2 never does (cap)', () => {
    const o = go(1, 'accept-with-gap', 30);
    expect(o.go).toBe(true); expect(o.max).toBe(1); expect(o.remainingMs).toBe(210 * MIN); expect(o.nextDeadlineMs).toBe(205 * MIN);
    const o2 = go(2, 'accept-with-gap', 60);
    expect(o2.go).toBe(false); expect(o2.why).toBe('extra-attempt cap reached');
  });
  it('default trigger: a confident accept does not continue; accept-low-confidence does; custom trigger adds accept', () => {
    expect(go(1, 'accept', 10).go).toBe(false);
    expect(go(1, 'accept-low-confidence', 10).go).toBe(true);
    expect(go(1, 'accept', 10, { env: { CORTEX_SECOND_ATTEMPT_TRIGGER: 'accept,accept-with-gap' } }).go).toBe(true);
    expect(go(1, null, 10).go).toBe(false); // no resolver event → no further attempt (default set)
  });
  it("widening: the trigger token 'none' opens an attempt after a give-up (no verdict)", () => {
    const wide = { CORTEX_SECOND_ATTEMPT_TRIGGER: 'accept-with-gap,accept-low-confidence,accept,none' };
    const o = go(1, null, 30, { env: wide });
    expect(o.go).toBe(true); expect(o.action).toBeNull();
    expect(go(1, null, 30).why).toBe('action not in trigger set');
    expect(go(1, 'accept', 30, { env: { CORTEX_SECOND_ATTEMPT_TRIGGER: 'accept-with-gap,accept-low-confidence,accept' } }).go).toBe(true);
    expect(go(1, 'accept', 30).go).toBe(false);
  });
  it('MAX=3: continues at k=2,3, stops at the cap (k=4), on a non-trigger action, and when time runs out', () => {
    expect(go(2, 'accept-with-gap', 40, { mx: '3' }).go).toBe(true);
    expect(go(3, 'accept-low-confidence', 60, { mx: '3' }).go).toBe(true);
    const o = go(4, 'accept-with-gap', 70, { mx: '3' }); expect(o.go).toBe(false); expect(o.why).toBe('extra-attempt cap reached');
    const r = go(2, 'reject', 40, { mx: '3' }); expect(r.go).toBe(false); expect(r.why).toBe('action not in trigger set');
    const t = go(3, 'accept-with-gap', 125, { mx: '3' }); expect(t.go).toBe(false); expect(t.why).toContain('below minimum'); expect(t.remainingFrac!).toBeLessThan(0.5);
    expect(go(3, 'accept-with-gap', 120, { mx: '3' }).go).toBe(true); // exactly MIN_REMAINING (0.5) still continues
    expect(go(2, 'accept-with-gap', 60, { mx: '3', env: { CORTEX_SECOND_ATTEMPT_MIN_REMAINING: '0.8' } }).go).toBe(false);
  });
  it('15-minute floor after the 5-minute reserve (short deadline: 40 min)', () => {
    expect(go(1, 'accept-with-gap', 20, { dl: 40 * MIN }).go).toBe(true); // 20 min left → 15 min attempt
    const o = go(1, 'accept-with-gap', 21, { dl: 40 * MIN, env: { CORTEX_SECOND_ATTEMPT_MIN_REMAINING: '0.1' } });
    expect(o.go).toBe(false); expect(o.why).toContain('15 min');
  });
  it("wall clock, not the attempt's own remainingFrac (and the reverse)", () => {
    const o = go(2, 'accept-with-gap', 168, { mx: '3', ev: 0.95 });
    expect(o.go).toBe(false); expect(Math.abs(o.remainingFrac! - 0.3)).toBeLessThan(1e-6); expect(o.eventRemainingFrac).toBe(0.95);
    const r = go(2, 'accept-with-gap', 60, { mx: '3', ev: 0.05 });
    expect(r.go).toBe(true); expect(r.remainingMs).toBe(180 * MIN); expect(r.nextDeadlineMs).toBe(175 * MIN);
  });
  it('no start epoch: attempt 1 falls back to its own frac; later attempts never continue', () => {
    expect(go(1, 'accept-with-gap', 0, { ev: 0.7, t0: null }).go).toBe(true);
    expect(go(2, 'accept-with-gap', 0, { ev: 0.9, t0: null, mx: '3' }).go).toBe(false);
  });
  it('lever parsing: 0 = no extra attempts; junk = 1; no deadline = never', () => {
    expect(go(1, 'accept-with-gap', 10, { mx: '0' }).go).toBe(false);
    expect(go(1, 'accept-with-gap', 10, { mx: 'x' }).max).toBe(1);
    expect(go(1, 'accept-with-gap', 10, { dl: 0 }).go).toBe(false);
  });
  it('records the inputs the adapter banked (a<k>.json shape)', () => {
    const o = go(1, 'accept-with-gap', 30);
    expect(o).toMatchObject({ k: 1, action: 'accept-with-gap', deadlineMs: DL, elapsedMs: 30 * MIN, extraSoFar: 0, trigger: ['accept-with-gap', 'accept-low-confidence'], minRemaining: 0.5, why: 'continue' });
  });
});

// ---- selection (sa_pick parity) --------------------------------------------------------------------------------------------------
type AttOpts = { np?: number; iters?: number | null; check?: AttemptRecord['check']; finished?: boolean; sessTurns?: number | null; rem?: number | null; rc?: string | null };
function att(k: number, action: string | null, o: AttOpts = {}): AttemptRecord {
  const finished = k === 1 || ((o.finished ?? true) && action !== null);
  return { k, action, remainingFrac: o.rem ?? null, namedPassed: o.np ?? 0, check: o.check ?? 'none', iterations: o.iters === undefined ? null : o.iters, sessionTurns: o.sessTurns ?? null, finished, rc: o.rc ?? null };
}
const pick = (...a: AttemptRecord[]) => selectAttempt(a, 'make test');

describe('selectAttempt (sa_pick parity; verdict → FEWEST TURNS → named checks → earliest)', () => {
  it('rankVerdict', () => { expect([rankVerdict('accept'), rankVerdict('accept-with-gap'), rankVerdict('accept-low-confidence'), rankVerdict('veto'), rankVerdict(null)]).toEqual([2, 1, 1, 0, 0]); });
  it('MAX=1 shapes (two attempts)', () => {
    expect(pick(att(1, 'accept-with-gap', { np: 2, iters: 30 }), att(2, 'accept', { np: 1, iters: 40 })).pick).toBe(2); // MEETS beats gap
    expect(pick(att(1, 'accept-with-gap', { np: 2, iters: 30 }), att(2, 'accept-with-gap', { np: 3, iters: 40 })).pick).toBe(1); // both gap → fewest turns before named checks
    expect(pick(att(1, 'accept-with-gap', { np: 2, iters: 40 }), att(2, 'accept-with-gap', { np: 3, iters: 30 })).pick).toBe(2);
    expect(pick(att(1, 'accept-with-gap', { np: 2, iters: 30 }), att(2, 'accept-with-gap', { np: 3, iters: 30 })).pick).toBe(2); // equal turns → more judge checks
    expect(pick(att(1, 'accept-with-gap', { np: 2, iters: 30, check: 'pass' }), att(2, 'accept', { np: 5, iters: 10, check: 'fail' })).pick).toBe(1); // shipped check beats a better verdict
    const nf = pick(att(1, 'accept-with-gap', { np: 2, iters: 30 }), att(2, 'accept', { np: 5, iters: 10, finished: false, check: 'pass' }));
    expect(nf.pick).toBe(1); expect(nf.why).toContain('no finish: attempt 2');
    expect(pick(att(1, 'accept-with-gap', { np: 2, iters: 30 }), att(2, null, { np: 0, iters: 10 })).pick).toBe(1); // no verdict never wins
  });
  it('widening (2026-10-07): fewest turns beats more named checks on a verdict tie; verdict still outranks turns', () => {
    const s = pick(att(1, 'accept', { np: 4, iters: 200 }), att(2, 'accept', { np: 0, iters: 120 }));
    expect(s.pick).toBe(2); expect(s.why).toContain('fewest tool-call turns');
    expect(pick(att(1, 'accept', { np: 0, iters: 200 }), att(2, 'accept-with-gap', { np: 5, iters: 50 })).pick).toBe(1);
    expect(pick(att(1, 'accept', { np: 1, iters: 100 }), att(2, 'accept', { np: 3, iters: 100 })).pick).toBe(2);
  });
  it('full order over a chain of 4: check > verdict > turns > namedPassed > earliest', () => {
    const a = pick(att(1, 'accept', { np: 9, iters: 5, check: 'fail' }), att(2, 'accept-with-gap', { np: 0, iters: 90, check: 'pass' }), att(3, 'accept', { np: 1, iters: 50, check: 'pass' }), att(4, 'accept', { np: 1, iters: 40, check: 'fail' }));
    expect(a.pick).toBe(3); expect(a.why.startsWith('shipped check passes only on attempt 2,3')).toBe(true);
    const b = pick(att(1, 'accept-with-gap', { np: 9, iters: 5, check: 'pass' }), att(2, 'accept', { np: 1, iters: 90, check: 'pass' }), att(3, 'accept', { np: 2, iters: 50, check: 'pass' }), att(4, 'accept', { np: 2, iters: 60, check: 'pass' }));
    expect(b.pick).toBe(3); expect(b.why).toContain('fewest tool-call turns');
    const c = pick(att(1, 'accept-with-gap', { np: 1, iters: 20 }), att(2, 'accept-low-confidence', { np: 1, iters: 20 }), att(3, 'accept-with-gap', { np: 1, iters: 20 }));
    expect(c.pick).toBe(1); expect(c.why).toContain('no evidence separates');
    const d = pick(att(1, 'accept-with-gap', { np: 1, iters: 20 }), att(2, 'accept-with-gap', { np: 1, iters: 12 }), att(3, 'accept-with-gap', { np: 1, iters: 12 }));
    expect(d.pick).toBe(2); expect(d.why).toContain('earliest attempt');
    expect(pick(att(1, 'accept-with-gap', { np: 3 }), att(2, 'accept-with-gap', { np: 3 }), att(3, 'accept', { np: 0 })).pick).toBe(3); // verdict beats namedPassed
  });
  it('turns: when any candidate lacks toolCallIterations, every candidate is measured from its session', () => {
    const s = pick(att(1, 'accept-with-gap', { np: 1, iters: 10, sessTurns: 30 }), att(2, 'accept-with-gap', { np: 1, iters: null, sessTurns: 12 }), att(3, 'accept-with-gap', { np: 1, iters: 5, sessTurns: 20 }));
    expect(s.pick).toBe(2); expect(s.turnsSource).toBe('session'); expect(s.attempts.map((a) => a.turns)).toEqual([30, 12, 20]);
  });
  it("check 'skipped' / missing = not passing; 'none' everywhere = no filter", () => {
    expect(pick(att(1, 'accept', { np: 1, iters: 50, check: 'pass' }), att(2, 'accept', { np: 1, iters: 10, check: 'skipped' }), att(3, 'accept', { np: 1, iters: 20 })).pick).toBe(1);
  });
  it('the banked record: every attempt + the R194 v1 keys', () => {
    const s = pick(att(1, 'accept-with-gap', { np: 2, iters: 30, check: 'fail', rem: 0.8 }), att(2, 'accept', { np: 4, iters: 25, check: 'pass', rem: 0.55, rc: '0' }));
    const a2 = s.attempts[1]!;
    expect(s.pick).toBe(2); expect(a2).toMatchObject({ k: 2, remainingFrac: 0.55, check: 'pass', turns: 25, rc: '0' });
    expect(s.attempt1!.action).toBe('accept-with-gap'); expect(s.attempt2!.namedPassed).toBe(4); expect(s.shippedCheck).toBe('make test');
  });
});

describe('mergeAttemptResponses (sa_merge parity + deep usage sum)', () => {
  const resp = (k: number, inp: number, iters: number) => ({ messageId: `m${k}`, content: `c${k}`, usage: { inputTokens: inp, outputTokens: 10, totalTokens: inp + 10, session: { requests: 1, inputTokens: inp, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, uncachedInputTokens: inp, reasoningTokens: 0, helper: { calls: 1, inputTokensEst: 5, outputTokensEst: 1, bySurface: { judge: 6 } }, subagents: { calls: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, uncachedInputTokens: 0, reasoningTokens: 0, helperInputTokensEst: 0, helperOutputTokensEst: 0 }, model: `m${k}` } }, model: { id: 'x', provider: 'y' }, metadata: { conversationId: 'c', usedHelperModel: false, compactionTriggered: false, toolCallIterations: iters } }) as any;
  it('returns the pick with usage.session summed over every attempt and the selection on usage + metadata', () => {
    const sel = pick(att(1, 'accept-with-gap', { np: 1, iters: 30 }), att(2, 'accept-with-gap', { np: 1, iters: 12 }), att(3, 'accept-with-gap', { np: 1, iters: 20 }));
    expect(sel.pick).toBe(2);
    const r = mergeAttemptResponses([resp(1, 100, 30), resp(2, 200, 12), resp(3, 50, 20)], sel)!;
    expect(r.messageId).toBe('m2'); expect(r.usage.session).toMatchObject({ inputTokens: 350, outputTokens: 30, requests: 3, model: 'm3' });
    expect(r.usage.session!.helper).toEqual({ calls: 3, inputTokensEst: 15, outputTokensEst: 3, bySurface: { judge: 18 } }); // deep sum (parity caveat)
    expect((r.metadata as any).toolCallIterations).toBe(12); expect((r.metadata as any).secondAttempt.pick).toBe(2); expect((r.usage as any).secondAttempt.pick).toBe(2);
  });
  it('chosen response unreadable → falls back to the latest readable one; nothing readable → null', () => {
    const sel = pick(att(1, 'accept-with-gap', { np: 1, iters: 30 }), att(2, 'accept-with-gap', { np: 1, iters: 12 }), att(3, 'accept-with-gap', { np: 1, iters: 20 }));
    const r = mergeAttemptResponses([resp(1, 100, 30), null, resp(3, 50, 20)], sel)!;
    expect(r.messageId).toBe('m3'); expect(r.usage.session!.inputTokens).toBe(150);
    expect(mergeAttemptResponses([null, null], sel)).toBeNull();
  });
});

describe('shipped check + session turns', () => {
  it('detects the entry point in the adapter order and runs it bounded', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-chk-'));
    try {
      expect(detectShippedCheck(d)).toBeNull();
      fs.mkdirSync(path.join(d, 'tests')); expect(detectShippedCheck(d)).toContain('pytest');
      fs.writeFileSync(path.join(d, 'run_tests.sh'), 'exit 0\n'); expect(detectShippedCheck(d)).toBe('sh ./run_tests.sh');
      fs.writeFileSync(path.join(d, 'test.sh'), 'exit 1\n'); expect(detectShippedCheck(d)).toBe('sh ./test.sh');
      fs.writeFileSync(path.join(d, 'Makefile'), 'build:\n\ttrue\n'); expect(detectShippedCheck(d)).toBe('sh ./test.sh');
      fs.writeFileSync(path.join(d, 'Makefile'), 'test:\n\ttrue\n'); expect(detectShippedCheck(d)).toBe('make test');
      expect(runShippedCheck('sh ./run_tests.sh', d, 10_000).result).toBe('pass');
      expect(runShippedCheck('sh ./test.sh', d, 10_000).result).toBe('fail');
      expect(runShippedCheck('sleep 5', d, 300).result).toBe('fail');
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it('counts assistant records with tool_use blocks in both record shapes', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-sess-'));
    try {
      const p = path.join(d, 's.jsonl');
      const rows = [
        { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
        { message: { role: 'assistant', content: [{ type: 'tool_use', toolUse: { id: 't', name: 'Read', input: {} } }] } },
        { message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
        { message: { role: 'user', content: 'x' } },
      ];
      fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\nnot json\n');
      expect(countSessionToolTurns(p)).toBe(2);
      expect(countSessionToolTurns(path.join(d, 'missing.jsonl'))).toBeNull();
      expect(countSessionToolTurns(undefined)).toBeNull();
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});
