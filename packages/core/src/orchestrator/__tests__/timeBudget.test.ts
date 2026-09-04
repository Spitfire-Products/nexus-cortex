import { describe, it, expect } from 'vitest';
import { resolveTurnDeadlineMs, timeBudgetState, timeBudgetWarnNudge } from '../timeBudget.js';

describe('resolveTurnDeadlineMs (#2)', () => {
  it('disabled by default (0) → no behaviour change when unset', () => {
    expect(resolveTurnDeadlineMs(undefined, {} as NodeJS.ProcessEnv)).toBe(0);
    expect(resolveTurnDeadlineMs(0, {} as NodeJS.ProcessEnv)).toBe(0);
  });
  it('configured value wins', () => {
    expect(resolveTurnDeadlineMs(300_000, {} as NodeJS.ProcessEnv)).toBe(300_000);
  });
  it('env CORTEX_TURN_DEADLINE_MS used when no config', () => {
    expect(resolveTurnDeadlineMs(undefined, { CORTEX_TURN_DEADLINE_MS: '810000' } as NodeJS.ProcessEnv)).toBe(810_000);
    expect(resolveTurnDeadlineMs(undefined, { CORTEX_TURN_DEADLINE_MS: 'nope' } as NodeJS.ProcessEnv)).toBe(0);
  });
});

describe('timeBudgetState (#2)', () => {
  it('deadline <=0 → always ok (opt-in, no regression)', () => {
    expect(timeBudgetState(999_999, 0)).toBe('ok');
    expect(timeBudgetState(999_999, -1)).toBe('ok');
  });
  it('ok below warnFrac, warn between warnFrac and deadline, break at/after deadline', () => {
    expect(timeBudgetState(0, 1000)).toBe('ok');
    expect(timeBudgetState(800, 1000)).toBe('ok'); // < 90%
    expect(timeBudgetState(900, 1000)).toBe('warn'); // == 90%
    expect(timeBudgetState(950, 1000)).toBe('warn');
    expect(timeBudgetState(1000, 1000)).toBe('break');
    expect(timeBudgetState(1200, 1000)).toBe('break');
  });
  it('custom warnFrac respected', () => {
    expect(timeBudgetState(700, 1000, 0.75)).toBe('ok');
    expect(timeBudgetState(750, 1000, 0.75)).toBe('warn');
  });
});

describe('timeBudgetWarnNudge (#2)', () => {
  it('reports remaining seconds and tells the model to converge + EndTurn', () => {
    const n = timeBudgetWarnNudge(900_000, 1_000_000);
    expect(n).toContain('~100s left');
    expect(n.toLowerCase()).toContain('endturn');
    expect(n.toLowerCase()).toContain('converge');
  });
});
