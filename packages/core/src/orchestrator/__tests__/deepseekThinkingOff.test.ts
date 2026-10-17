/**
 * CORTEX_ACTION_EFFORT=none / disableThinking → DeepSeek chat requests carry the EXPLICIT
 * `thinking: { type: 'disabled' }` field (2026-10-17, 4.125.4).
 *
 * Live probe on deepseek-flash (V4.1-Flash-1017): `{thinking:{type:enabled}, reasoning_effort:none}`
 * still reasons; `{reasoning_effort:none}` alone and `{thinking:{type:disabled}}` do not. Before this
 * change the harness only OMITTED reasoning_effort for `none` and sent no thinking field, so a
 * "thinking-off" action arm would have run at the provider default (thinking ON) — a silent control.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { APIClient } from '../APIClient.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import type { PreparedRequest } from '../../adapters/GatewayTranslationLayer.js';

const deepseekReasoning = {
  id: 'deepseek-flash',
  modelId: 'deepseek-flash',
  provider: 'deepseek',
  reasoning: { supported: true, toggleable: true, defaultEffort: 'high' },
  tools: { supported: true },
  api: {
    pattern: 'chat/completions',
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
  },
} as unknown as ModelConfig;

const openaiReasoning = {
  ...deepseekReasoning,
  id: 'gpt-x', modelId: 'gpt-x', provider: 'openai',
  api: { pattern: 'chat/completions', endpoint: 'https://api.openai.com/v1/chat/completions', apiKeyEnvVar: 'OPENAI_API_KEY' },
} as unknown as ModelConfig;

const req = (parameters: Record<string, unknown>, extra: Partial<PreparedRequest> = {}): PreparedRequest => ({
  messages: [{ type: 'message', role: 'user', content: 'hi' }] as any,
  tools: [],
  headers: {},
  parameters: { max_tokens: 16, ...parameters },
  modelId: 'deepseek-flash',
  ...extra,
});

describe('DeepSeek chat: explicit thinking-off field', () => {
  const prevDs = process.env.DEEPSEEK_API_KEY; const prevOa = process.env.OPENAI_API_KEY;
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'k'; process.env.OPENAI_API_KEY = 'k'; });
  afterEach(() => {
    if (prevDs === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevDs;
    if (prevOa === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevOa;
  });
  const build = (r: PreparedRequest, m = deepseekReasoning) =>
    (new APIClient() as any).buildChatCompletionsRequest(r, m, { stream: false }).chatRequest;

  it('effort high → reasoning_effort sent, no thinking field (thinking ON)', () => {
    const c = build(req({ reasoningEffort: 'high' }));
    expect(c.reasoning_effort).toBe('high');
    expect(c.thinking).toBeUndefined();
  });

  it('effort none → thinking.type=disabled and NO reasoning_effort', () => {
    const c = build(req({ reasoningEffort: 'none' }));
    expect(c.thinking).toEqual({ type: 'disabled' });
    expect(c.reasoning_effort).toBeUndefined();
  });

  it('disableThinking (continuation flag) → thinking.type=disabled', () => {
    const c = build(req({ reasoningEffort: 'high', disableThinking: true }));
    expect(c.thinking).toEqual({ type: 'disabled' });
    expect(c.reasoning_effort).toBeUndefined();
  });

  it('forced tool_choice still disables thinking (pre-existing path)', () => {
    const c = build(req({ reasoningEffort: 'high' }, { toolChoice: { type: 'function', function: { name: 'bash' } } } as any));
    expect(c.thinking).toEqual({ type: 'disabled' });
  });

  it('no effort, no flag → provider default (no thinking field)', () => {
    const c = build(req({}));
    expect(c.thinking).toBeUndefined();
  });

  it('non-DeepSeek chat provider never gets the DeepSeek thinking field', () => {
    const c = build(req({ reasoningEffort: 'none' }), openaiReasoning);
    expect(c.thinking).toBeUndefined();
  });
});
