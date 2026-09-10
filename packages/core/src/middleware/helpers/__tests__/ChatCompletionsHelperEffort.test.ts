/**
 * MENTOR ROLE on the wire (HB-MENTOR-THINKING, 2026-09-10): the ChatCompletions helper adapter reads the
 * resolved `mentorRole` a mentor call carries — thinking on → `reasoning_effort`, thinking off → thinking
 * disabled — keeps the helper-role default (`defaultEffort: 'none'`) for cheap helper configs, and still
 * disables thinking for a registry-resolved DeepSeek card that carries no role (helper-role call). Wire-verified
 * against DeepSeek the same day: thinking:{disabled} → 0 reasoning tokens; reasoning_effort:'max' → reasoning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: any[] = [];
vi.mock('../../../orchestrator/cortexProxyFetch.js', () => ({
  cortexProxyFetch: vi.fn(async (_url: any, init: any) => {
    captured.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ id: 'x', object: 'chat.completion', created: 0, model: 'deepseek-flash', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) } as any;
  }),
}));

import { ChatCompletionsAPIHelperAdapter } from '../adapters/ChatCompletionsAPIHelperAdapter.js';
import { resolveMentorRoleConfig } from '../../../training/mentorRole.js';

const base = {
  id: 'deepseek-flash', provider: 'deepseek', family: 'deepseek-v4', displayName: 'x',
  api: { pattern: 'chat/completions', endpoint: 'https://api.deepseek.com/chat/completions', apiKeyEnvVar: 'DEEPSEEK_API_KEY', authHeader: 'Authorization', authPrefix: 'Bearer' },
  limits: { contextWindow: 1000000, outputTokens: 65536, requestsPerMinute: 1000, tokensPerMinute: 1000000 },
  reasoning: { supported: true, toggleable: true, effort: 'medium' },
} as any;
const msgs = [{ role: 'user', content: 'hi' }] as any;

describe('ChatCompletionsAPIHelperAdapter — mentor role on the wire', () => {
  beforeEach(() => { captured.length = 0; process.env.DEEPSEEK_API_KEY = 'test'; });

  it('mentor thinking ON → reasoning_effort=max, no thinking-disabled, mentor temperature honoured', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, mentorRole: { thinking: true, effort: 'max', temperature: 0.2, surface: 'lift-plan' } }, 4000);
    expect(captured[0].reasoning_effort).toBe('max');
    expect(captured[0].thinking).toBeUndefined();
    expect(captured[0].temperature).toBe(0.2);
  });

  it('mentor thinking OFF (CORTEX_MENTOR_REASONING=none) → thinking disabled, no reasoning_effort', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, mentorRole: { thinking: false, effort: 'max', surface: 'endturn-resolver' } }, 4000);
    expect(captured[0].reasoning_effort).toBeUndefined();
    expect(captured[0].thinking).toEqual({ type: 'disabled' });
  });

  it('helper-role call on a registry card (no mentorRole) keeps thinking disabled', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, base, 4000);
    expect(captured[0].reasoning_effort).toBeUndefined();
    expect(captured[0].thinking).toEqual({ type: 'disabled' });
    expect(captured[0].temperature).toBe(0.7);
  });

  it('cheap helper config with defaultEffort none still sends reasoning_effort=none (helper role wins over any mentorRole)', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, reasoning: { supported: true, defaultEffort: 'none' }, mentorRole: { thinking: true, effort: 'max', surface: 'lift-plan' } }, 4000);
    expect(captured[0].reasoning_effort).toBe('none');
  });
});

describe('HelperModelMiddleware.generateGuidance carries the resolved mentor role', () => {
  const mk = async () => {
    const { HelperModelMiddleware } = await import('../../HelperModelMiddleware.js');
    const mw: any = new (HelperModelMiddleware as any)({ helperModelId: 'deepseek-flash' });
    mw.helperAdapterRegistry = { getAdapterForModel: () => new ChatCompletionsAPIHelperAdapter() };
    mw.modelRegistry = { hasModel: () => true, getModel: () => ({ ...base }) };
    return mw;
  };
  it('planner surface with CORTEX_MENTOR_REASONING=none → thinking disabled on the wire', async () => {
    process.env.CORTEX_MENTOR_REASONING = 'none';
    try {
      const mw = await mk(); captured.length = 0;
      const mentor = resolveMentorRoleConfig('lift-plan', process.env, { modelId: 'deepseek-flash', effort: 'max' });
      await mw.generateGuidance({ surface: 'lift-plan', persona: 'p', task: 't', outputBudgetTokens: 100, mentor }, 'body', 'deepseek-flash');
      expect(captured[0].thinking).toEqual({ type: 'disabled' });
      expect(captured[0].reasoning_effort).toBeUndefined();
    } finally { delete process.env.CORTEX_MENTOR_REASONING; }
  });
  it('planner surface by default → reasoning_effort=max on the wire', async () => {
    const mw = await mk(); captured.length = 0;
    const mentor = resolveMentorRoleConfig('endturn-resolver', process.env, { modelId: 'deepseek-flash', effort: 'max' });
    await mw.generateGuidance({ surface: 'endturn-resolver', persona: 'p', task: 't', outputBudgetTokens: 100, mentor }, 'body', 'deepseek-flash');
    expect(captured[0].reasoning_effort).toBe('max');
  });
  it('the consult stays thinking-off by default and opts in via CORTEX_MENTOR_CONSULT_REASONING=on', async () => {
    const mw = await mk(); captured.length = 0;
    await mw.generateGuidance({ surface: 'mentor-consult', persona: 'p', task: 't', outputBudgetTokens: 400, mentor: resolveMentorRoleConfig('mentor-consult', process.env, { modelId: 'deepseek-flash' }) }, 'body', 'deepseek-flash');
    expect(captured[0].thinking).toEqual({ type: 'disabled' });
    process.env.CORTEX_MENTOR_CONSULT_REASONING = 'on';
    try {
      captured.length = 0;
      await mw.generateGuidance({ surface: 'mentor-consult', persona: 'p', task: 't', outputBudgetTokens: 400, mentor: resolveMentorRoleConfig('mentor-consult', process.env, { modelId: 'deepseek-flash', effort: 'max' }) }, 'body', 'deepseek-flash');
      expect(captured[0].reasoning_effort).toBe('max');
    } finally { delete process.env.CORTEX_MENTOR_CONSULT_REASONING; }
  });
});
