/**
 * thrashDetector — shape-agnostic struggle signal (MENTORSHIP_ASK_FOR_ADVICE_SPEC §2).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveThrashState,
  resolveThrashConfig,
  THRASH_DEFAULTS,
} from '../thrashDetector.js';

const F = false, T = true;
const cfg = THRASH_DEFAULTS; // {failThreshold:4, window:6, minTurns:5}

describe('thrashDetector', () => {
  it('does not fire before the turn floor', () => {
    // 4 failures but only 4 turns (< minTurns 5)
    const s = resolveThrashState([F, F, F, F], 4, cfg);
    expect(s.thrashing).toBe(false);
  });

  it('does not fire without a full window', () => {
    // 4 failures, turnCount 5, but only 4 outcomes (window needs 6)
    const s = resolveThrashState([F, F, F, F], 5, cfg);
    expect(s.thrashing).toBe(false);
  });

  it('does not fire below the failure threshold', () => {
    // window of 6, only 3 failures
    const s = resolveThrashState([T, T, T, F, F, F], 6, cfg);
    expect(s.failures).toBe(3);
    expect(s.thrashing).toBe(false);
  });

  it('FIRES at the threshold with a full window and a currently-failing tail', () => {
    // 4 failures in the last 6, most recent is a failure
    const s = resolveThrashState([T, T, F, F, F, F], 6, cfg);
    expect(s.failures).toBe(4);
    expect(s.thrashing).toBe(true);
  });

  it('does NOT fire right after a success (progress just made)', () => {
    // 4 failures in window but the last call SUCCEEDED
    const s = resolveThrashState([F, F, F, F, F, T], 6, cfg);
    expect(s.failures).toBe(5);
    expect(s.thrashing).toBe(false); // currentlyFailing gate
  });

  it('examines only the last `window` outcomes', () => {
    // 20 calls, but only the last 6 count; last 6 = 5 fails incl. tail
    const outcomes = [...Array(14).fill(T), T, F, F, F, F, F];
    const s = resolveThrashState(outcomes, 20, cfg);
    expect(s.examined).toBe(6);
    expect(s.failures).toBe(5);
    expect(s.thrashing).toBe(true);
  });

  it('resolveThrashConfig reads env overrides, falls back on garbage', () => {
    const c = resolveThrashConfig({ CORTEX_THRASH_FAILS: '3', CORTEX_THRASH_WINDOW: 'x', CORTEX_THRASH_MIN_TURNS: '0' } as NodeJS.ProcessEnv);
    expect(c.failThreshold).toBe(3);
    expect(c.window).toBe(THRASH_DEFAULTS.window);   // 'x' → default
    expect(c.minTurns).toBe(THRASH_DEFAULTS.minTurns); // 0 not >0 → default
  });

  it('a lower env threshold fires earlier', () => {
    const c = resolveThrashConfig({ CORTEX_THRASH_FAILS: '3', CORTEX_THRASH_WINDOW: '4', CORTEX_THRASH_MIN_TURNS: '4' } as NodeJS.ProcessEnv);
    const s = resolveThrashState([T, F, F, F], 4, c);
    expect(s.thrashing).toBe(true);
  });
});
