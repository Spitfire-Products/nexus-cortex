import { describe, it, expect } from 'vitest';
import {
  RESOLVER_SYSTEM,
  buildResolverUserPrompt,
  resolveEndTurnResolverConfig,
  parseResolverVerdict,
} from '../endTurnResolver.js';

describe('endTurnResolver — resolveEndTurnResolverConfig', () => {
  it('defaults to max/4000 and 2 max-rejects', () => {
    const c = resolveEndTurnResolverConfig({} as NodeJS.ProcessEnv);
    expect(c.outputBudgetTokens).toBe(4000);
    expect(c.effort).toBe('max');
    expect(c.maxRejects).toBe(2);
  });
  it('honors overrides (incl. maxRejects=0)', () => {
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_MAX_REJECTS: '0' } as any).maxRejects).toBe(0);
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_EFFORT: 'medium' } as any).effort).toBe('medium');
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_BUDGET_TOKENS: '2000' } as any).outputBudgetTokens).toBe(2000);
  });
});

describe('endTurnResolver — RESOLVER_SYSTEM (the yes/no judge)', () => {
  it('demands a machine-parseable VERDICT line and a fix plan on GAP', () => {
    expect(RESOLVER_SYSTEM).toMatch(/VERDICT: MEETS/);
    expect(RESOLVER_SYSTEM).toMatch(/VERDICT: GAP/);
    expect(RESOLVER_SYSTEM).toMatch(/fix plan/i);
    expect(RESOLVER_SYSTEM).toMatch(/hidden grader|task's real requirements/i);
    expect(RESOLVER_SYSTEM).toMatch(/own test/i); // anti-self-graded
  });
});

describe('endTurnResolver — buildResolverUserPrompt', () => {
  it('includes task + work product; env + attestation only when given', () => {
    const full = buildResolverUserPrompt({ task: 'do X', envReport: 'tooling: uv', workProduct: 'built Y', attestation: 'req A: done' });
    expect(full).toContain('TASK:');
    expect(full).toContain('do X');
    expect(full).toContain('WORK PRODUCT');
    expect(full).toContain('built Y');
    expect(full).toContain('ENVIRONMENT REPORT');
    expect(full).toContain('ATTESTATION');
    const bare = buildResolverUserPrompt({ task: 'do X', workProduct: 'built Y' });
    expect(bare).not.toContain('ENVIRONMENT REPORT');
    expect(bare).not.toContain('ATTESTATION');
  });
});

describe('endTurnResolver — parseResolverVerdict', () => {
  it('parses MEETS', () => {
    const v = parseResolverVerdict('VERDICT: MEETS\nlooks complete');
    expect(v).toMatchObject({ meets: true, parsed: true });
  });
  it('parses GAP and extracts the plan after the verdict line', () => {
    const v = parseResolverVerdict('VERDICT: GAP\n1. add NOT_FOUND handling\n2. rerun make test');
    expect(v.meets).toBe(false);
    expect(v.parsed).toBe(true);
    expect(v.plan).toContain('NOT_FOUND');
  });
  it('fail-opens to MEETS on empty/unparseable text (never traps the junior)', () => {
    expect(parseResolverVerdict('')).toMatchObject({ meets: true, parsed: false });
    expect(parseResolverVerdict('the model rambled with no verdict line')).toMatchObject({ meets: true, parsed: false });
  });
  it('is case-insensitive on the verdict token', () => {
    expect(parseResolverVerdict('verdict: gap\nfix it').meets).toBe(false);
  });
});
