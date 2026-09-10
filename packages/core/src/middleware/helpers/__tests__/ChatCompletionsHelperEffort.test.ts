/**
 * MENTOR ROLE on the wire (HB-MENTOR-THINKING, 2026-09-10): the ChatCompletions helper adapter reads the
 * resolved `mentorRole` a mentor call carries — thinking on → `reasoning_effort`, thinking off → thinking
 * disabled — keeps the helper-role default (`defaultEffort: 'none'`) for cheap helper configs, and still
 * disables thinking for a registry-resolved DeepSeek card that carries no role (helper-role call). Wire-verified
 * against DeepSeek the same day: thinking:{disabled} → 0 reasoning tokens; reasoning_effort:'max' → reasoning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: any[] = [];
/** Per-call scripted responses (HB-MENTOR-BUDGET tests); empty = the default 'ok' reply. */
const scripted: any[] = [];
vi.mock('../../../orchestrator/cortexProxyFetch.js', () => ({
  cortexProxyFetch: vi.fn(async (_url: any, init: any) => {
    captured.push(JSON.parse(init.body));
    const next = scripted.length ? scripted.shift() : { content: 'ok', finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    return { ok: true, json: async () => ({ id: 'x', object: 'chat.completion', created: 0, model: 'deepseek-flash', choices: [{ index: 0, message: { role: 'assistant', content: next.content, reasoning_content: next.reasoning_content }, finish_reason: next.finish_reason }], usage: next.usage }) } as any;
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
  beforeEach(() => { captured.length = 0; scripted.length = 0; process.env.DEEPSEEK_API_KEY = 'test'; delete process.env.CORTEX_MENTOR_REASONING_ALLOWANCE; });

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


describe('HB-MENTOR-BUDGET — reasoning shares max_tokens, so a thinking-on mentor call gets an allowance and never returns blank silently', () => {
  beforeEach(() => { captured.length = 0; scripted.length = 0; process.env.DEEPSEEK_API_KEY = 'test'; delete process.env.CORTEX_MENTOR_REASONING_ALLOWANCE; });

  it('thinking ON: max_tokens = content budget + per-effort allowance (high → +12000), capped by the card', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, mentorRole: { thinking: true, effort: 'high', surface: 'endturn-resolver' } }, 4000);
    expect(captured[0].max_tokens).toBe(16000);
    await a.generate(msgs, { ...base, limits: { ...base.limits, outputTokens: 5000 }, mentorRole: { thinking: true, effort: 'max', surface: 'lift-plan' } }, 4000);
    expect(captured[1].max_tokens).toBe(5000);
  });

  it('thinking OFF / helper-role calls keep the plain content cap', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, mentorRole: { thinking: false, effort: 'max', surface: 'lift-plan' } }, 4000);
    expect(captured[0].max_tokens).toBe(4000);
    await a.generate(msgs, base, 1500);
    expect(captured[1].max_tokens).toBe(1500);
  });

  it('CORTEX_MENTOR_REASONING_ALLOWANCE overrides the table', async () => {
    process.env.CORTEX_MENTOR_REASONING_ALLOWANCE = '2000';
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, mentorRole: { thinking: true, effort: 'max', surface: 'lift-plan' } }, 4000);
    expect(captured[0].max_tokens).toBe(6000);
  });

  it('a thinking-on call that returns EMPTY content (finish_reason=length, all reasoning) is retried ONCE thinking-off and the meta says so', async () => {
    scripted.push({ content: '', reasoning_content: 'x'.repeat(100), finish_reason: 'length', usage: { prompt_tokens: 1, completion_tokens: 4000, total_tokens: 4001, completion_tokens_details: { reasoning_tokens: 4000 } } });
    scripted.push({ content: 'VERDICT: GAP\n1. do the thing', finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 20, total_tokens: 21 } });
    const a = new ChatCompletionsAPIHelperAdapter();
    const out = await a.generate(msgs, { ...base, mentorRole: { thinking: true, effort: 'max', surface: 'endturn-resolver' } }, 4000);
    expect(out).toContain('VERDICT: GAP');
    expect(captured.length).toBe(2);
    expect(captured[0].reasoning_effort).toBe('max');
    expect(captured[1].thinking).toEqual({ type: 'disabled' });
    expect(captured[1].reasoning_effort).toBeUndefined();
    expect(a.lastCallMeta).toMatchObject({ thinking: true, truncated: true, retriedThinkingOff: true, reasoningTokens: 4000, contentChars: out.length, finishReason: 'stop' });
    expect(a.lastCallMeta!.maxTokensSent).toBe(28000);      // the thinking-on call: 4000 + max allowance 24000
    expect(a.lastCallMeta!.retryMaxTokensSent).toBe(4000);  // the retry (thinking off) went out at the plain content cap
  });

  it('a thinking-on call that DELIVERS content is not retried and the meta records the wire cap', async () => {
    scripted.push({ content: 'VERDICT: MEETS', finish_reason: 'stop', usage: { prompt_tokens: 1, completion_tokens: 900, total_tokens: 901, completion_tokens_details: { reasoning_tokens: 700 } } });
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, mentorRole: { thinking: true, effort: 'low', surface: 'endturn-resolver' } }, 4000);
    expect(captured.length).toBe(1);
    expect(a.lastCallMeta).toMatchObject({ thinking: true, truncated: false, retriedThinkingOff: false, reasoningTokens: 700, maxTokensSent: 8000 });
  });
});
