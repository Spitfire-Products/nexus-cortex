/**
 * Transport reasoning-effort fixes (2026-10-02; stack-portability N1). Each DARK flag: off = byte-identical request,
 * on = the effort reaches the wire. Every case goes through the REAL GatewayTranslationLayer.prepareRequest with a real
 * model card, then the REAL APIClient builder; the body is captured at the SDK / fetch boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const chatCreate = vi.fn();
const responsesCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: chatCreate } };
    responses = { create: responsesCreate };
    constructor(_opts: unknown) {}
  },
}));

import { APIClient } from '../APIClient.js';
import { GatewayTranslationLayer } from '../../adapters/GatewayTranslationLayer.js';
import {
  anthropicOutputEffort,
  anthropicMaxEffortBudget,
  geminiThinkingConfigForEffort,
  isGeminiThinkingLevelModel,
} from '../transportEffortFixes.js';
import { firstRequestActionEffort } from '../transportEffortFixes.js';
import { gpt56 } from '../../models/cards/openai/gpt-5-6.js';
import { deepseekV4Flash } from '../../models/cards/deepseek/deepseek-v4-flash.js';
import { claudeSonnet5 } from '../../models/cards/anthropic/claude-sonnet-5.js';
import { claudeSonnet46 } from '../../models/cards/anthropic/claude-sonnet-4-6.js';
import { gemini37Flash } from '../../models/cards/google/gemini-3-7-flash.js';
import { gemini25Flash } from '../../models/cards/google/gemini-2-5-flash.js';
import { gemini25FlashSDK } from '../../models/cards/google/gemini-2-5-flash-sdk.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const FLAGS = ['CORTEX_OPENAI_TOOLS_REASONING', 'CORTEX_ANTHROPIC_EFFORT', 'CORTEX_GEMINI_TOOLS_THINKING'] as const;
const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_PROMPT_CACHING',
  'CORTEX_DELIVER_SYSTEM_PROMPT', 'DEBUG_THINKING', 'CORTEX_GEMINI_SYSTEM_FIX'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [...FLAGS, ...KEYS]) saved[k] = process.env[k];
  for (const k of FLAGS) delete process.env[k];
  for (const k of ['ANTHROPIC_PROMPT_CACHING', 'CORTEX_DELIVER_SYSTEM_PROMPT', 'DEBUG_THINKING', 'GOOGLE_API_KEY', 'CORTEX_GEMINI_SYSTEM_FIX']) delete process.env[k];
  for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY']) process.env[k] = 'test-key';
  chatCreate.mockReset();
  responsesCreate.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of [...FLAGS, ...KEYS]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const TOOLS = [
  { name: 'Bash', description: 'run a command', schema: { type: 'object', properties: { command: { type: 'string', description: 'cmd' } }, required: ['command'] } },
  { name: 'Edit', description: 'edit a file', schema: { type: 'object', properties: { path: { type: 'string', description: 'p' } }, required: ['path'] } },
] as any[];
const MSGS = [{ role: 'user', content: [{ type: 'text', text: 'Fix the bug.' }] }] as any[];

function prepare(card: ModelConfig, opts: Record<string, unknown>, tools: any[] | undefined = TOOLS) {
  return new GatewayTranslationLayer().prepareRequest(MSGS, tools, card, { maxTokens: 64000, staticSystemPrompt: 'SYS', ...opts } as any);
}
/** Run the same request flag-off then flag-on; return both wire bodies. */
async function offOn(flag: string, run: () => Promise<any>): Promise<{ off: any; off2: any; on: any }> {
  delete process.env[flag];
  const off = await run();
  process.env[flag] = 'off';
  const off2 = await run();
  process.env[flag] = 'on';
  const on = await run();
  delete process.env[flag];
  return { off, off2, on };
}

// ---------------------------------------------------------------------------------------------------------
// CORTEX_OPENAI_TOOLS_REASONING
// ---------------------------------------------------------------------------------------------------------
const okChat = { id: 'c', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };

describe('CORTEX_OPENAI_TOOLS_REASONING', () => {
  async function chatBody(card: ModelConfig, opts: Record<string, unknown>, tools?: any[]) {
    chatCreate.mockResolvedValue(okChat);
    await (new APIClient() as any).sendRequest(prepare(card, opts, tools), card);
    return chatCreate.mock.calls.at(-1)![0];
  }

  it('gpt-5.6 chat + tools + action effort high: reasoning_effort stays DROPPED on/off (R19b; OpenAI 400s the pair on chat — live 2026-10-03)', async () => {
    expect(gpt56.api.pattern).toBe('chat/completions');
    const { off, on } = await offOn('CORTEX_OPENAI_TOOLS_REASONING', () => chatBody(gpt56, { reasoningEffort: 'high' }));
    expect(off.reasoning_effort).toBeUndefined();
    expect(on.reasoning_effort).toBeUndefined();
    expect(on.tools).toHaveLength(2);
  });

  it('on, chat WITHOUT tools: max effort reaches the wire verbatim; no effort → builder default "medium"', async () => {
    process.env.CORTEX_OPENAI_TOOLS_REASONING = 'on';
    expect((await chatBody(gpt56, { reasoningEffort: 'max' }, [])).reasoning_effort).toBe('max');
    expect((await chatBody(gpt56, {}, [])).reasoning_effort).toBe('medium');
  });

  it('gateway: off = effort withheld from an OpenAI card (no toggleable); on = forwarded; non-OpenAI cards unchanged', () => {
    const off = prepare(gpt56, { reasoningEffort: 'high' });
    expect((off.parameters as any).reasoningEffort).toBeUndefined();
    process.env.CORTEX_OPENAI_TOOLS_REASONING = 'on';
    expect((prepare(gpt56, { reasoningEffort: 'high' }).parameters as any).reasoningEffort).toBe('high');
    // DeepSeek (toggleable) behaves identically either way
    const ds = prepare(deepseekV4Flash, { reasoningEffort: 'high' });
    delete process.env.CORTEX_OPENAI_TOOLS_REASONING;
    expect(JSON.stringify(prepare(deepseekV4Flash, { reasoningEffort: 'high' }))).toBe(JSON.stringify(ds));
  });

  it('DeepSeek chat request is byte-identical with the flag on', async () => {
    const { off, on } = await offOn('CORTEX_OPENAI_TOOLS_REASONING', () => chatBody(deepseekV4Flash, { reasoningEffort: 'high' }));
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
  });

  it('Responses (OpenAI): on = the action effort reaches reasoning.effort', async () => {
    const resp = { ...gpt56, api: { ...gpt56.api, pattern: 'responses', endpoint: 'https://api.openai.com/v1/responses' },
      tools: { ...gpt56.tools, adapter: 'ResponsesAPIAdapter' } } as unknown as ModelConfig;
    responsesCreate.mockResolvedValue({ id: 'r1', object: 'response', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } });
    await (new APIClient() as any).sendRequest(prepare(resp, { reasoningEffort: 'high' }), resp);
    expect(responsesCreate.mock.calls[0][0].reasoning).toBeUndefined();
    process.env.CORTEX_OPENAI_TOOLS_REASONING = 'on';
    await (new APIClient() as any).sendRequest(prepare(resp, { reasoningEffort: 'high' }), resp);
    expect(responsesCreate.mock.calls[1][0].reasoning).toEqual({ effort: 'high', summary: 'auto' });
  });
});

// ---------------------------------------------------------------------------------------------------------
// CORTEX_ANTHROPIC_EFFORT
// ---------------------------------------------------------------------------------------------------------
function anthClient() {
  const create = vi.fn(async () => ({ id: 'm', content: [], stop_reason: 'end_turn', usage: {} }));
  const stream = vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {}, finalMessage: async () => ({}) }));
  const client: any = new APIClient();
  client.anthropicClient = { messages: { create, stream } };
  return { client, create, stream };
}
async function anthBody(card: ModelConfig, opts: Record<string, unknown>, mode: 'send' | 'stream' = 'send') {
  const a = anthClient();
  if (mode === 'send') { await a.client.sendRequest(prepare(card, opts), card); return a.create.mock.calls[0][0]; }
  a.client.streamRequest(prepare(card, opts), card);
  return a.stream.mock.calls[0][0];
}

describe('CORTEX_ANTHROPIC_EFFORT', () => {
  it('adaptive (claude-sonnet-5): off = thinking adaptive, NO output_config (byte-identical); on = output_config.effort', async () => {
    for (const mode of ['send', 'stream'] as const) {
      const { off, off2, on } = await offOn('CORTEX_ANTHROPIC_EFFORT', () => anthBody(claudeSonnet5, { reasoningEffort: 'high' }, mode));
      expect(off.thinking).toEqual({ type: 'adaptive' });
      expect(off.output_config).toBeUndefined();
      expect(JSON.stringify(off2)).toBe(JSON.stringify(off));
      expect(on.output_config).toEqual({ effort: 'high' });
      const { output_config: _o, ...rest } = on;
      expect(JSON.stringify(rest)).toBe(JSON.stringify(off));
    }
  });

  it('adaptive: every level maps 1:1; none / no effort → no output_config', async () => {
    process.env.CORTEX_ANTHROPIC_EFFORT = 'on';
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) expect((await anthBody(claudeSonnet5, { reasoningEffort: e })).output_config).toEqual({ effort: e });
    expect((await anthBody(claudeSonnet5, { reasoningEffort: 'none' })).output_config).toBeUndefined();
    expect((await anthBody(claudeSonnet5, {})).output_config).toBeUndefined();
  });

  it('non-adaptive (claude-sonnet-4-6) max: off = budget 10000 (the || 10000 fallback); on = 62976 (< max_tokens 64000)', async () => {
    for (const mode of ['send', 'stream'] as const) {
      const { off, off2, on } = await offOn('CORTEX_ANTHROPIC_EFFORT', () => anthBody(claudeSonnet46, { reasoningEffort: 'max' }, mode));
      expect(off.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 });
      expect(JSON.stringify(off2)).toBe(JSON.stringify(off));
      expect(on.max_tokens).toBe(64000);
      expect(on.thinking).toEqual({ type: 'enabled', budget_tokens: 62976 });
      expect(on.output_config).toBeUndefined();
      expect(JSON.stringify({ ...on, thinking: off.thinking })).toBe(JSON.stringify(off));
    }
  });

  it('non-adaptive: low/medium/high unchanged with the flag on', async () => {
    for (const e of ['low', 'medium', 'high']) {
      const { off, on } = await offOn('CORTEX_ANTHROPIC_EFFORT', () => anthBody(claudeSonnet46, { reasoningEffort: e }));
      expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    }
  });

  it('helpers: output effort + max budget clamp', () => {
    expect(anthropicOutputEffort('HIGH')).toBe('high');
    expect(anthropicOutputEffort('none')).toBeUndefined();
    expect(anthropicOutputEffort(undefined)).toBeUndefined();
    expect(anthropicMaxEffortBudget(128000)).toBe(120000);
    expect(anthropicMaxEffortBudget(64000)).toBe(62976);
    expect(anthropicMaxEffortBudget(2000)).toBeUndefined(); // floor 1024 not reachable → caller keeps legacy value
    expect(anthropicMaxEffortBudget(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------
// CORTEX_GEMINI_TOOLS_THINKING
// ---------------------------------------------------------------------------------------------------------
const geminiBody = { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
function captureFetch(sse = false) {
  const calls: { url: string; body: any }[] = [];
  const spy = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    let text: string | undefined = typeof init?.body === 'string' ? init.body : undefined;
    if (text === undefined && input && typeof input === 'object' && typeof input.clone === 'function') text = await input.clone().text();
    calls.push({ url, body: text ? JSON.parse(text) : undefined });
    if (sse) return new Response(`data: ${JSON.stringify(geminiBody)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    return new Response(JSON.stringify(geminiBody), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}
async function gemBody(card: ModelConfig, opts: Record<string, unknown>, mode: 'send' | 'stream' = 'send') {
  const calls = captureFetch(mode === 'stream');
  const client: any = new APIClient();
  if (mode === 'send') await client.sendRequest(prepare(card, opts), card);
  else { const s = client.streamRequest(prepare(card, opts), card); try { for await (const _c of s.chunks) { /* drain */ } await s.finalMessage; } catch { /* captured */ } }
  return calls[0]!.body;
}
const genCfg = (b: any) => b.generation_config ?? b.generationConfig;

describe('CORTEX_GEMINI_TOOLS_THINKING', () => {
  it('REST gemini-3.7-flash + tools + effort high: off = no thinkingConfig (byte-identical); on = thinkingLevel "high"', async () => {
    for (const mode of ['send', 'stream'] as const) {
      const { off, off2, on } = await offOn('CORTEX_GEMINI_TOOLS_THINKING', () => gemBody(gemini37Flash, { reasoningEffort: 'high' }, mode));
      expect(genCfg(off).thinkingConfig).toBeUndefined();
      expect(JSON.stringify(off2)).toBe(JSON.stringify(off));
      expect(genCfg(on).thinkingConfig).toEqual({ thinkingLevel: 'high' });
      const strip = (b: any) => JSON.stringify({ ...b, generation_config: { ...genCfg(b), thinkingConfig: undefined } });
      expect(strip(on)).toBe(strip(off));
    }
  });

  it('REST gemini-2.5-flash + tools: on = thinkingBudget by effort (low 2048 / medium 8192 / high 16384 / max 24576)', async () => {
    process.env.CORTEX_GEMINI_TOOLS_THINKING = 'on';
    const want: Record<string, number> = { low: 2048, medium: 8192, high: 16384, max: 24576 };
    for (const [e, b] of Object.entries(want)) expect(genCfg(await gemBody(gemini25Flash, { reasoningEffort: e })).thinkingConfig).toEqual({ thinkingBudget: b });
    expect(genCfg(await gemBody(gemini25Flash, {})).thinkingConfig).toBeUndefined(); // no effort → API default
  });

  it('@google/genai SDK (gemini-2.5-flash-sdk) + tools: off = thinkingConfig skipped; on = effort-mapped thinkingConfig', async () => {
    const { off, off2, on } = await offOn('CORTEX_GEMINI_TOOLS_THINKING', () => gemBody(gemini25FlashSDK, { reasoningEffort: 'high' }));
    expect(JSON.stringify(off2)).toBe(JSON.stringify(off));
    expect(off.generationConfig?.thinkingConfig).toBeUndefined();
    expect(on.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 16384 }); // non-streaming: no includeThoughts
    // streaming SDK + tools: thought summaries requested (the stream parser routes part.thought to thinking deltas)
    process.env.CORTEX_GEMINI_TOOLS_THINKING = 'on';
    expect((await gemBody(gemini25FlashSDK, { reasoningEffort: 'high' }, 'stream')).generationConfig.thinkingConfig)
      .toEqual({ includeThoughts: true, thinkingBudget: 16384 });
    // no effort → the no-tools default budget
    expect((await gemBody(gemini25FlashSDK, {})).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 10000 });
  });

  it('helpers: level vs budget by model generation', () => {
    expect(isGeminiThinkingLevelModel('gemini-3.7-flash')).toBe(true);
    expect(isGeminiThinkingLevelModel('models/gemini-3.1-pro-preview')).toBe(true);
    expect(isGeminiThinkingLevelModel('gemini-2.5-flash-sdk')).toBe(false);
    expect(geminiThinkingConfigForEffort('gemini-3.7-flash', 'max')).toEqual({ thinkingLevel: 'high' });
    expect(geminiThinkingConfigForEffort('gemini-3.7-flash', 'none')).toBeUndefined();
    expect(geminiThinkingConfigForEffort('gemini-2.5-pro', 'low')).toEqual({ thinkingBudget: 2048 });
  });
});

describe('firstRequestActionEffort (CORTEX_ACTION_EFFORT_FIRST)', () => {
  it('off = undefined (byte-identical request 0)', () => {
    expect(firstRequestActionEffort({ CORTEX_ACTION_EFFORT: 'high' } as any)).toBeUndefined();
  });
  it('on = the action effort for request 0', () => {
    expect(firstRequestActionEffort({ CORTEX_ACTION_EFFORT_FIRST: 'on', CORTEX_ACTION_EFFORT: 'high' } as any)).toBe('high');
    expect(firstRequestActionEffort({ CORTEX_ACTION_EFFORT_FIRST: 'on' } as any)).toBeUndefined();
  });
});
