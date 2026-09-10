import { describe, it, expect } from 'vitest';
import { resolveMentorRoleConfig, describeMentorWire, mentorWireHint } from '../mentorRole.js';

describe('mentorRole — the mentor as a first-class resolved role', () => {
  it('planner surfaces think by default at the surface effort; model from MENTORSHIP_HELPER_MODEL', () => {
    const c = resolveMentorRoleConfig('endturn-resolver', { MENTORSHIP_HELPER_MODEL: 'deepseek-v4-pro' } as any, { effort: 'max', outputBudgetTokens: 4000 });
    expect(c.modelId).toBe('deepseek-v4-pro');
    expect(c.thinking).toBe(true);
    expect(c.effort).toBe('max');
    expect(c.thinkingSource).toBe('code-default');
    expect(describeMentorWire(c)).toEqual({ model: 'deepseek-v4-pro', thinking: true, effort: 'max', budget: 4000 });
  });
  it('CORTEX_MENTOR_REASONING=none reproduces the pre-4.103.0 thinking-off baseline for planners', () => {
    const c = resolveMentorRoleConfig('lift-plan', { CORTEX_MENTOR_REASONING: 'none' } as any, { effort: 'max' });
    expect(c.thinking).toBe(false);
    expect(c.thinkingSource).toBe('CORTEX_MENTOR_REASONING');
    expect(describeMentorWire(c).effort).toBe('none');
  });
  it('the consult is thinking-off by default and opts in via CORTEX_MENTOR_CONSULT_REASONING', () => {
    expect(resolveMentorRoleConfig('mentor-consult', {} as any).thinking).toBe(false);
    expect(resolveMentorRoleConfig('mentor-consult', {} as any).outputBudgetTokens).toBe(400);
    const on = resolveMentorRoleConfig('mentor-consult', { CORTEX_MENTOR_CONSULT_REASONING: 'on' } as any, { effort: 'max' });
    expect(on.thinking).toBe(true);
    expect(on.thinkingSource).toBe('CORTEX_MENTOR_CONSULT_REASONING');
  });
  it('caller model override wins; effort is normalised; temperature is optional and bounded', () => {
    const c = resolveMentorRoleConfig('deadline-exit-mentor', { MENTORSHIP_HELPER_MODEL: 'deepseek-flash', CORTEX_MENTOR_TEMPERATURE: '0.2' } as any, { modelId: 'deepseek-v4-pro', effort: 'MAX ' });
    expect(c.modelId).toBe('deepseek-v4-pro');
    expect(c.effort).toBe('max');
    expect(c.temperature).toBe(0.2);
    expect(resolveMentorRoleConfig('loop-exit-planner', { CORTEX_MENTOR_TEMPERATURE: '9' } as any).temperature).toBeUndefined();
    expect(resolveMentorRoleConfig('loop-exit-planner', {} as any, { effort: 'bogus' }).effort).toBe('max');
  });
  it('the wire hint carries only what the adapter needs', () => {
    const h = mentorWireHint(resolveMentorRoleConfig('lift-plan', {} as any, { effort: 'high' }));
    expect(h).toEqual({ thinking: true, effort: 'high', surface: 'lift-plan' });
  });
});

describe('CORTEX_MENTOR_EFFORT — one lever for every planner surface, per-surface var wins', () => {
  it('global lever applies when the surface var is unset', () => {
    expect(resolveMentorRoleConfig('lift-plan', { CORTEX_MENTOR_EFFORT: 'low' } as any, { effort: 'max' }).effort).toBe('low');
    expect(resolveMentorRoleConfig('loop-exit-planner', { CORTEX_MENTOR_EFFORT: 'high' } as any, { effort: 'max' }).effort).toBe('high');
  });
  it('an explicitly set per-surface *_EFFORT wins over the global lever', () => {
    expect(resolveMentorRoleConfig('endturn-resolver', { CORTEX_MENTOR_EFFORT: 'low', CORTEX_ENDTURN_RESOLVER_EFFORT: 'max' } as any, { effort: 'max' }).effort).toBe('max');
  });
  it('unset everywhere → the surface resolver value (its code default max)', () => {
    expect(resolveMentorRoleConfig('deadline-exit-mentor', {} as any, { effort: 'max' }).effort).toBe('max');
  });
});
