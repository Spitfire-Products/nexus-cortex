/**
 * HB-MENTOR-THINKING (2026-09-10): the ChatCompletions helper adapter must send the MENTOR's explicit
 * reasoning effort on the wire (`reasoning_effort`), keep the helper-role "thinking off" default for cheap
 * helper configs (`defaultEffort: 'none'`), and still disable thinking for a registry-resolved DeepSeek card
 * that carries no explicit mentor effort. Wire-verified against DeepSeek the same day: thinking:{disabled}
 * → 0 reasoning tokens; reasoning_effort:'max' → reasoning present.
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

const base = {
  id: 'deepseek-flash', provider: 'deepseek', family: 'deepseek-v4', displayName: 'x',
  api: { pattern: 'chat/completions', endpoint: 'https://api.deepseek.com/chat/completions', apiKeyEnvVar: 'DEEPSEEK_API_KEY', authHeader: 'Authorization', authPrefix: 'Bearer' },
  limits: { contextWindow: 1000000, outputTokens: 65536, requestsPerMinute: 1000, tokensPerMinute: 1000000 },
} as any;
const msgs = [{ role: 'user', content: 'hi' }] as any;

describe('ChatCompletionsAPIHelperAdapter — reasoning effort on the wire', () => {
  beforeEach(() => { captured.length = 0; process.env.DEEPSEEK_API_KEY = 'test'; });

  it('MENTOR call (effortExplicit) sends reasoning_effort=max and does NOT disable thinking', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, reasoning: { supported: true, toggleable: true, effort: 'max', effortExplicit: true } }, 4000);
    expect(captured[0].reasoning_effort).toBe('max');
    expect(captured[0].thinking).toBeUndefined();
  });

  it('registry card with NO explicit mentor effort (helper role) keeps thinking disabled', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, reasoning: { supported: true, toggleable: true, effort: 'medium' } }, 4000);
    expect(captured[0].reasoning_effort).toBeUndefined();
    expect(captured[0].thinking).toEqual({ type: 'disabled' });
  });

  it('cheap helper config with defaultEffort none still sends reasoning_effort=none (helper role wins)', async () => {
    const a = new ChatCompletionsAPIHelperAdapter();
    await a.generate(msgs, { ...base, reasoning: { supported: true, defaultEffort: 'none' } }, 4000);
    expect(captured[0].reasoning_effort).toBe('none');
    expect(captured[0].thinking).toBeUndefined();
  });
});
