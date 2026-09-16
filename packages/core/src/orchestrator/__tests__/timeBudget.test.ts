import { describe, it, expect } from 'vitest';
import { resolveTurnDeadlineMs, timeBudgetState, timeBudgetWarnNudge, resolveBudgetVisibility, resolveBudgetContinueMinRemaining, budgetBand, budgetVisibilityLine, formatBudgetHM } from '../timeBudget.js';

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

describe('R151 HB-BUDGET-VISIBILITY', () => {
  it('bands: -1 without a deadline, 0..10 across the budget', () => {
    expect(budgetBand(1000, 0)).toBe(-1);
    expect(budgetBand(0, 100_000)).toBe(0);
    expect(budgetBand(9_999, 100_000)).toBe(0);
    expect(budgetBand(10_000, 100_000)).toBe(1);
    expect(budgetBand(43 * 60_000, 480 * 60_000)).toBe(0); // 43 min of 8 h is still band 0
    expect(budgetBand(250_000, 100_000)).toBe(10);
  });
  it('line names total, elapsed, percent and remaining', () => {
    const line = budgetVisibilityLine(43 * 60_000, 480 * 60_000);
    expect(line).toContain('WALL BUDGET: 8h00m total');
    expect(line).toContain('elapsed 43m (9%)');
    expect(line).toContain('~7h17m remaining');
    expect(formatBudgetHM(65 * 60_000)).toBe('1h05m');
  });
  it('levers: visibility defaults on, continue fraction defaults 0.5, 0 disables', () => {
    expect(resolveBudgetVisibility({} as any)).toBe(true);
    expect(resolveBudgetVisibility({ CORTEX_BUDGET_VISIBILITY: 'false' } as any)).toBe(false);
    expect(resolveBudgetContinueMinRemaining({} as any)).toBe(0.5);
    expect(resolveBudgetContinueMinRemaining({ CORTEX_BUDGET_CONTINUE_MIN_REMAINING: '0' } as any)).toBe(0);
    expect(resolveBudgetContinueMinRemaining({ CORTEX_BUDGET_CONTINUE_MIN_REMAINING: '0.25' } as any)).toBe(0.25);
  });
});

// R157: continue-with-budget nudges per turn.
import { resolveBudgetContinueMaxNudges } from '../timeBudget.js';
describe('resolveBudgetContinueMaxNudges (R157)', () => {
  it('defaults to 2; 0/negative/garbage → 0 (off); clamps to 10', () => {
    expect(resolveBudgetContinueMaxNudges({})).toBe(2);
    expect(resolveBudgetContinueMaxNudges({ CORTEX_BUDGET_CONTINUE_MAX_NUDGES: '3' })).toBe(3);
    expect(resolveBudgetContinueMaxNudges({ CORTEX_BUDGET_CONTINUE_MAX_NUDGES: '0' })).toBe(0);
    expect(resolveBudgetContinueMaxNudges({ CORTEX_BUDGET_CONTINUE_MAX_NUDGES: 'x' })).toBe(0);
    expect(resolveBudgetContinueMaxNudges({ CORTEX_BUDGET_CONTINUE_MAX_NUDGES: '50' })).toBe(10);
  });
});
