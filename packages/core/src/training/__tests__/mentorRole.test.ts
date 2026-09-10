import { describe, it, expect } from 'vitest';
import { resolveMentorRoleConfig, describeMentorWire, mentorWireHint, reasoningAllowanceTokens, describeMentorDelivery } from '../mentorRole.js';

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


describe('HB-MENTOR-BUDGET — reasoningAllowanceTokens', () => {
  it('per-effort table by default; unknown effort → max; env override wins (incl. 0)', () => {
    expect(reasoningAllowanceTokens('low', {} as any)).toBe(4000);
    expect(reasoningAllowanceTokens('medium', {} as any)).toBe(8000);
    expect(reasoningAllowanceTokens('high', {} as any)).toBe(12000);
    expect(reasoningAllowanceTokens('max', {} as any)).toBe(24000);
    expect(reasoningAllowanceTokens('bogus', {} as any)).toBe(24000);
    expect(reasoningAllowanceTokens('max', { CORTEX_MENTOR_REASONING_ALLOWANCE: '3000' } as any)).toBe(3000);
    expect(reasoningAllowanceTokens('max', { CORTEX_MENTOR_REASONING_ALLOWANCE: '0' } as any)).toBe(0);
    expect(reasoningAllowanceTokens('max', { CORTEX_MENTOR_REASONING_ALLOWANCE: 'nope' } as any)).toBe(24000);
  });
});


describe('describeMentorDelivery — who actually delivered the mentor text (transcript/decisions disambiguation)', () => {
  const wire = { model: 'deepseek-v4-pro', thinking: true, effort: 'high', budget: 4000 };
  const meta = (o: Partial<Parameters<typeof describeMentorDelivery>[1] & object>) => ({ contentChars: 0, maxTokensSent: 16000, thinking: true, truncated: false, retriedThinkingOff: false, ...o } as any);
  it('no meta (timeout / in flight / error) → none, and the requested config is kept', () => {
    expect(describeMentorDelivery(wire, null)).toMatchObject({ model: 'deepseek-v4-pro', thinking: true, effort: 'high', deliveredBy: 'none', deliveredThinking: false, deliveredEffort: 'none' });
  });
  it('thinking-on request that returned content → thinking-on, deliveredEffort = requested effort', () => {
    expect(describeMentorDelivery(wire, meta({ contentChars: 900, reasoningTokens: 700, finishReason: 'stop' }))).toMatchObject({ deliveredBy: 'thinking-on', deliveredThinking: true, deliveredEffort: 'high', reasoningTokens: 700, maxTokensSent: 16000 });
  });
  it('thinking-on request came back EMPTY and the thinking-off retry delivered → thinking-off-retry, NOT thinking-on', () => {
    const d = describeMentorDelivery(wire, meta({ contentChars: 1200, truncated: true, retriedThinkingOff: true, retryMaxTokensSent: 4000, reasoningTokens: 4000 }));
    expect(d).toMatchObject({ thinking: true, effort: 'high', deliveredBy: 'thinking-off-retry', deliveredThinking: false, deliveredEffort: 'none', truncated: true, retriedThinkingOff: true, retryMaxTokensSent: 4000 });
  });
  it('empty even after the retry → none', () => {
    expect(describeMentorDelivery(wire, meta({ contentChars: 0, truncated: true, retriedThinkingOff: true }))).toMatchObject({ deliveredBy: 'none', deliveredThinking: false, deliveredEffort: 'none' });
  });
  it('a thinking-off request that delivered → thinking-off', () => {
    expect(describeMentorDelivery({ ...wire, thinking: false, effort: 'none' }, meta({ contentChars: 500, thinking: false, maxTokensSent: 4000 }))).toMatchObject({ deliveredBy: 'thinking-off', deliveredThinking: false, deliveredEffort: 'none' });
  });
});
