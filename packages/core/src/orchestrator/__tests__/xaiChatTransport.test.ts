/**
 * xAI chat/completions — the THIRD xAI transport (DARK, 2026-10-03). Every case goes through the REAL
 * GatewayTranslationLayer.prepareRequest with a real model card, then the REAL APIClient chat builder; the body and the
 * OpenAI client construction (baseURL / headers / apiKey) are captured at the SDK boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const chatCreate = vi.fn();
const ctorOpts: any[] = [];
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: chatCreate } };
    responses = { create: vi.fn() };
    constructor(opts: unknown) { ctorOpts.push(opts); }
  },
}));

import { APIClient } from '../APIClient.js';
import { GatewayTranslationLayer } from '../../adapters/GatewayTranslationLayer.js';
import { isXAIChatRoute, xaiChatReasoningEffort } from '../xaiChatTransport.js';
import { createXAIModelConfig } from '../../models/configurators/XAIConfigurator.js';
import { grok43Chat } from '../../models/cards/xai/grok-4-3-chat.js';
import { grokBuild01Chat } from '../../models/cards/xai/grok-build-0-1-chat.js';
import { grok43 } from '../../models/cards/xai/grok-4-3.js';
import { grokBuild01 } from '../../models/cards/xai/grok-build-0-1.js';
import { shouldUseServerSideTools, getResponsesAPIEndpoint } from '../../adapters/ServerSideToolDetection.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const KEYS = ['XAI_API_KEY', 'CORTEX_DELIVER_SYSTEM_PROMPT', 'DEBUG_THINKING', 'ENABLE_SERVER_SIDE_TOOLS', 'XAI_API_MODE', 'CORTEX_STREAM_USAGE'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.XAI_API_KEY = 'test-key';
  chatCreate.mockReset();
  ctorOpts.length = 0;
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const TOOLS = [
  { name: 'Bash', description: 'run a command', schema: { type: 'object', properties: { command: { type: 'string', description: 'cmd' } }, required: ['command'] } },
] as any[];
const MSGS = [{ role: 'user', content: [{ type: 'text', text: 'Fix the bug.' }] }] as any[];
const okChat = { id: 'c', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };

async function chatBody(card: ModelConfig, opts: Record<string, unknown> = {}, msgs: any[] = MSGS) {
  chatCreate.mockResolvedValue(okChat);
  const req = new GatewayTranslationLayer().prepareRequest(msgs, TOOLS, card, { maxTokens: 4096, staticSystemPrompt: 'SYS', conversationId: 'conv-1', ...opts } as any);
  await (new APIClient() as any).sendRequest(req, card);
  return { body: chatCreate.mock.calls.at(-1)![0], ctor: ctorOpts.at(-1) };
}

describe('XAIConfigurator apiMode chat', () => {
  it('chat cards: pattern/endpoint/auth/adapter, wire model name, no server-side tools', () => {
    for (const card of [grok43Chat, grokBuild01Chat]) {
      expect(card.provider).toBe('xai');
      expect(card.api.pattern).toBe('chat/completions');
      expect(card.api.endpoint).toBe('https://api.x.ai/v1/chat/completions');
      expect(card.api.apiKeyEnvVar).toBe('XAI_API_KEY');
      expect(card.api.authHeader).toBe('authorization');
      expect((card.api as any).authPrefix).toBe('Bearer ');
      expect(card.tools.adapter).toBe('ChatCompletionsAPIAdapter');
      expect(card.serverSideTools).toBeUndefined();
      expect(isXAIChatRoute(card)).toBe(true);
    }
    expect(grok43Chat.modelId).toBe('grok-4.3');
    expect(grokBuild01Chat.modelId).toBe('grok-build-0.1');
    expect(grok43Chat.reasoning?.defaultEffort).toBe('high');
    expect(grokBuild01Chat.reasoning?.defaultEffort).toBeUndefined();
  });

  it('XAI_API_MODE=chat moves an UN-pinned card; a pinned card keeps its pin; unset keeps messages', () => {
    const opts = { id: 'g', displayName: 'G', family: 'grok-4', contextWindow: 1, outputTokens: 1, inputCost: 0, outputCost: 0 };
    expect(createXAIModelConfig(opts).api.pattern).toBe('messages');
    expect(createXAIModelConfig(opts).serverSideTools?.supported).toBe(true);
    process.env.XAI_API_MODE = 'chat';
    const moded = createXAIModelConfig(opts);
    expect(moded.api.pattern).toBe('chat/completions');
    expect(moded.serverSideTools).toBeUndefined();
    expect(createXAIModelConfig({ ...opts, apiMode: 'messages' }).api.pattern).toBe('messages');
    // explicit opt-back-in keeps server tools (then ServerSideToolDetection may route to /v1/responses)
    expect(createXAIModelConfig({ ...opts, supportsServerSideTools: true }).serverSideTools?.supported).toBe(true);
  });

  it('existing messages cards are untouched by the new mode (grok-4.3 / grok-build-0.1)', () => {
    expect(grok43.api.pattern).toBe('messages');
    expect(grok43.api.endpoint).toBe('https://api.x.ai/v1/messages');
    expect(grokBuild01.api.pattern).toBe('messages');
  });

  it('ENABLE_SERVER_SIDE_TOOLS=true never re-routes a chat card; Responses endpoint derivation strips /v1/chat/completions', () => {
    process.env.ENABLE_SERVER_SIDE_TOOLS = 'true';
    const tools = [{ name: 'web_search', description: 'x', schema: { type: 'object', properties: {} } }, ...TOOLS] as any[];
    const det = shouldUseServerSideTools(grok43Chat, tools);
    expect(det.useServerSideTools).toBe(false);
    expect(det.apiPattern).toBe('chat/completions');
    expect(det.endpoint).toBe('https://api.x.ai/v1/chat/completions');
    expect(getResponsesAPIEndpoint(grok43Chat)).toBe('https://api.x.ai/v1/responses');
    expect(getResponsesAPIEndpoint(grok43)).toBe('https://api.x.ai/v1/responses');
  });
});

describe('xaiChatReasoningEffort (per-card capability gate)', () => {
  it('no declared effort → never sent (grok-build-0.1), whatever is requested', () => {
    for (const e of [undefined, 'low', 'high', 'max', 'xhigh']) expect(xaiChatReasoningEffort(e, grokBuild01Chat)).toBeUndefined();
  });
  it('declared effort → request wins, max→high, none/unknown → card default', () => {
    expect(xaiChatReasoningEffort(undefined, grok43Chat)).toBe('high');
    expect(xaiChatReasoningEffort('low', grok43Chat)).toBe('low');
    expect(xaiChatReasoningEffort('medium', grok43Chat)).toBe('medium');
    expect(xaiChatReasoningEffort('max', grok43Chat)).toBe('high');
    expect(xaiChatReasoningEffort('xhigh', grok43Chat)).toBe('xhigh');
    expect(xaiChatReasoningEffort('none', grok43Chat)).toBe('high');
    expect(xaiChatReasoningEffort('bogus', grok43Chat)).toBe('high');
  });
});

describe('APIClient chat builder — provider xai', () => {
  it('grok-4.3-chat: endpoint base + Bearer key + x-grok-conv-id; card effort high; wire model grok-4.3; no DeepSeek fields', async () => {
    const { body, ctor } = await chatBody(grok43Chat);
    expect(ctor.baseURL).toBe('https://api.x.ai/v1');
    expect(ctor.apiKey).toBe('test-key'); // OpenAI SDK sends it as `Authorization: Bearer <key>`
    expect(ctor.defaultHeaders).toEqual({ 'x-grok-conv-id': 'conv-1' });
    expect(body.model).toBe('grok-4.3');
    expect(body.reasoning_effort).toBe('high');
    expect(body.thinking).toBeUndefined();          // DeepSeek-only forced-tool_choice disable
    expect(body.prompt_cache_key).toBeUndefined();  // OpenAI-only R225
    expect(body.tools).toHaveLength(1);
  });

  it('grok-4.3-chat: request / CORTEX_ACTION_EFFORT reaches the wire (gateway forwards on the chat route only)', async () => {
    expect((await chatBody(grok43Chat, { reasoningEffort: 'low' })).body.reasoning_effort).toBe('low');
    expect((await chatBody(grok43Chat, { reasoningEffort: 'max' })).body.reasoning_effort).toBe('high');
    // the Messages card is NOT forwarded (toggleable:false gate unchanged)
    const msgReq = new GatewayTranslationLayer().prepareRequest(MSGS, TOOLS, grok43, { maxTokens: 4096, reasoningEffort: 'low' } as any);
    expect((msgReq.parameters as any).reasoningEffort).toBeUndefined();
  });

  it('grok-build-0.1-chat: reasoning_effort NEVER sent (xAI 400s it), even with an explicit effort', async () => {
    expect((await chatBody(grokBuild01Chat)).body).not.toHaveProperty('reasoning_effort');
    expect((await chatBody(grokBuild01Chat, { reasoningEffort: 'high' })).body).not.toHaveProperty('reasoning_effort');
    expect((await chatBody(grokBuild01Chat)).body.model).toBe('grok-build-0.1');
  });

  it('no conversationId → no headers', async () => {
    chatCreate.mockResolvedValue(okChat);
    const req = new GatewayTranslationLayer().prepareRequest(MSGS, TOOLS, grok43Chat, { maxTokens: 4096 } as any);
    await (new APIClient() as any).sendRequest(req, grok43Chat);
    expect(ctorOpts.at(-1).defaultHeaders).toBeUndefined();
  });

  it('reasoning_content is replayed on the assistant turn (non-empty only)', async () => {
    const history = [
      ...MSGS,
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'inspect first' },
        { type: 'tool_use', toolUse: { id: 'call_1', name: 'Bash', input: { command: 'ls' } } },
      ] },
      { role: 'user', content: [{ type: 'tool_result', toolResult: { tool_use_id: 'call_1', content: 'a.txt' } }] },
      { role: 'assistant', content: [
        { type: 'tool_use', toolUse: { id: 'call_2', name: 'Bash', input: { command: 'cat a.txt' } } },
      ] },
      { role: 'user', content: [{ type: 'tool_result', toolResult: { tool_use_id: 'call_2', content: 'hi' } }] },
    ];
    const { body } = await chatBody(grok43Chat, {}, history);
    const assistants = body.messages.filter((m: any) => m.role === 'assistant');
    expect(assistants).toHaveLength(2);
    expect(assistants[0].reasoning_content).toBe('inspect first');
    expect(assistants[0].tool_calls[0].function.name).toBeTruthy();
    expect(assistants[1]).not.toHaveProperty('reasoning_content');
  });
});

describe('usage / cache parsing — xAI chat (OpenAI-shape prompt_tokens_details.cached_tokens)', () => {
  it('reads cached_tokens + reasoning_tokens on provider xai chat/completions', () => {
    const gtl = new GatewayTranslationLayer();
    const resp = { usage: { prompt_tokens: 12000, completion_tokens: 300, total_tokens: 12300,
      prompt_tokens_details: { cached_tokens: 11900 }, completion_tokens_details: { reasoning_tokens: 250 } } };
    const u = (gtl as any).extractUsage(resp, grokBuild01Chat);
    expect(u.inputTokens).toBe(12000);
    expect(u.outputTokens).toBe(300);
    expect(u.cache.cacheReadTokens).toBe(11900);
    expect(u.cache.uncachedInputTokens).toBe(100);
    expect(u.cache.cacheHitRate).toBeCloseTo(11900 / 12000, 6);
    // card rates $1.00 in / $0.20 cached → 80% discount
    expect(u.cache.costSavingsRatio).toBeCloseTo((11900 * 0.8) / 12000, 6);
    expect(u.reasoningTokens).toBe(250);
  });
});
