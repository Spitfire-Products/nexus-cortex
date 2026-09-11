import { describe, it, expect } from 'vitest';
import {
  DEADLINE_EXIT_SYSTEM,
  resolveDeadlineExitConfig,
  deadlineExitCallBudget,
  buildDeadlineExitPrompt,
  parseDeadlineExitVerdict,
} from '../deadlineExitMentor.js';

describe('deadlineExitMentor — config', () => {
  it('is DARK by default (enabled=false), max/2000/45000/0.4', () => {
    const c = resolveDeadlineExitConfig({} as NodeJS.ProcessEnv);
    expect(c.enabled).toBe(false);
    expect(c.effort).toBe('max');
    expect(c.outputBudgetTokensCap).toBe(2000);
    expect(c.timeoutMsCap).toBe(45000);
    expect(c.residualFrac).toBe(0.4);
  });
  it('honors env overrides', () => {
    expect(resolveDeadlineExitConfig({ CORTEX_DEADLINE_EXIT_MENTOR: 'true' } as any).enabled).toBe(true);
    expect(resolveDeadlineExitConfig({ CORTEX_DEADLINE_EXIT_MENTOR_EFFORT: 'medium' } as any).effort).toBe('medium');
    expect(resolveDeadlineExitConfig({ CORTEX_DEADLINE_EXIT_MENTOR_RESIDUAL_FRAC: '0.25' } as any).residualFrac).toBe(0.25);
    // out-of-range frac falls back to default
    expect(resolveDeadlineExitConfig({ CORTEX_DEADLINE_EXIT_MENTOR_RESIDUAL_FRAC: '1.5' } as any).residualFrac).toBe(0.4);
  });
});

describe('deadlineExitMentor — deadlineExitCallBudget (never eats the residual)', () => {
  const cfg = resolveDeadlineExitConfig({} as NodeJS.ProcessEnv);
  it('scales to a fraction of the remaining wall-clock, capped', () => {
    // 200s residual × 0.4 = 80s, but capped at 45s
    expect(deadlineExitCallBudget(cfg, 200_000).timeoutMs).toBe(45_000);
    // 30s residual × 0.4 = 12s (under the cap) → 12s
    expect(deadlineExitCallBudget(cfg, 30_000).timeoutMs).toBe(12_000);
  });
  it('output budget tracks the allowed time and is bounded', () => {
    const { outputBudgetTokens } = deadlineExitCallBudget(cfg, 30_000); // ~12s → ~480 tok
    expect(outputBudgetTokens).toBeGreaterThanOrEqual(256);
    expect(outputBudgetTokens).toBeLessThanOrEqual(2000);
  });
});

describe('deadlineExitMentor — prompt', () => {
  it('offers the four verdicts and anchors to the grader criteria, not self-tests', () => {
    for (const v of ['CONTINUE', 'FINISH', 'ACTION', 'RETIRE']) expect(DEADLINE_EXIT_SYSTEM).toContain(`VERDICT: ${v}`);
    expect(DEADLINE_EXIT_SYSTEM).toMatch(/hidden grader|real criteria/i);
    expect(DEADLINE_EXIT_SYSTEM).toMatch(/own test/i);
    expect(DEADLINE_EXIT_SYSTEM).toMatch(/do NOT cut a near-win|closing in/i);
  });
  it('buildDeadlineExitPrompt includes budget + work; env/progress only when given', () => {
    const p = buildDeadlineExitPrompt({ task: 'do X', workProduct: 'built Y', remainingBudget: '~90s (10%)', envReport: 'uv present', recentProgress: 'step reduced failures 5→2' });
    expect(p).toContain('REMAINING BUDGET: ~90s (10%)');
    expect(p).toContain('WORK SO FAR');
    expect(p).toContain('ENVIRONMENT REPORT');
    expect(p).toContain('RECENT PROGRESS');
    const bare = buildDeadlineExitPrompt({ task: 'do X', workProduct: 'y', remainingBudget: '5s' });
    expect(bare).not.toContain('ENVIRONMENT REPORT');
    expect(bare).not.toContain('RECENT PROGRESS');
  });
});

describe('deadlineExitMentor — parseDeadlineExitVerdict', () => {
  it('parses each verdict + detail', () => {
    expect(parseDeadlineExitVerdict('VERDICT: CONTINUE')).toMatchObject({ decision: 'continue', parsed: true });
    expect(parseDeadlineExitVerdict('VERDICT: FINISH\ncriteria met')).toMatchObject({ decision: 'finish', parsed: true });
    const a = parseDeadlineExitVerdict('VERDICT: ACTION\nrun `make test` after adding the NOT_FOUND branch');
    expect(a.decision).toBe('action');
    expect(a.detail).toContain('NOT_FOUND');
    const r = parseDeadlineExitVerdict('VERDICT: RETIRE\ngcc missing, cannot install offline');
    expect(r.decision).toBe('retire');
    expect(r.detail).toContain('gcc');
  });
  it('fail-SAFE to CONTINUE on empty/unparseable (never truncate a turn on a broken call)', () => {
    expect(parseDeadlineExitVerdict('')).toMatchObject({ decision: 'continue', parsed: false });
    expect(parseDeadlineExitVerdict('rambled with no verdict')).toMatchObject({ decision: 'continue', parsed: false });
  });
  it('is case-insensitive', () => {
    expect(parseDeadlineExitVerdict('verdict: retire\nx').decision).toBe('retire');
  });
});


describe('4.107.0 — the deadline-exit mentor receives the lift plan', () => {
  it('adds the PLAN OF ATTACK section when given', () => {
    const p = buildDeadlineExitPrompt({ task: 'T', workProduct: 'W', remainingBudget: '~60s', liftPlan: '1. do a\n2. do b' } as any);
    expect(p).toContain('PLAN OF ATTACK'); expect(p).toContain('1. do a');
    expect(buildDeadlineExitPrompt({ task: 'T', workProduct: 'W', remainingBudget: '~60s' } as any)).not.toContain('PLAN OF ATTACK');
  });
});
