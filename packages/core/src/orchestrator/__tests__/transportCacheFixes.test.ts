/**
 * R224a / R225 / R229 / R230 transport cache + correctness fixes (2026-10-02). Each DARK flag: off = byte-identical
 * request, on = the fixed shape. Request bodies are captured at the SDK / fetch boundary.
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
import { shouldUseServerSideTools } from '../../adapters/ServerSideToolDetection.js';
import { countAnthropicBreakpoints } from '../transportFixes.js';
import { applyAnthropicCacheLevers, streamFinalUsage } from '../transportCacheFixes.js';
import { deepseekV4Flash } from '../../models/cards/deepseek/deepseek-v4-flash.js';
import { grok43 } from '../../models/cards/xai/grok-4-3.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import type { PreparedRequest } from '../../adapters/GatewayTranslationLayer.js';

const FLAGS = [
  'CORTEX_GEMINI_SYSTEM_FIX', 'CORTEX_STABLE_TOOL_ORDER', 'CORTEX_OPENAI_CACHE_KEY', 'CORTEX_ANTHROPIC_AUTO_CACHE',
  'CORTEX_ANTHROPIC_CACHE_TTL', 'CORTEX_FORCED_CHOICE_FULL_TOOLS', 'CORTEX_STREAM_USAGE', 'CORTEX_ANTHROPIC_HISTORY_CACHE',
] as const;
const KEYS = ['OPENAI_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_PROMPT_CACHING',
  'CORTEX_DELIVER_SYSTEM_PROMPT', 'ENABLE_SERVER_SIDE_TOOLS'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [...FLAGS, ...KEYS]) saved[k] = process.env[k];
  for (const k of FLAGS) delete process.env[k];
  delete process.env.ANTHROPIC_PROMPT_CACHING;
  delete process.env.CORTEX_DELIVER_SYSTEM_PROMPT;
  delete process.env.GOOGLE_API_KEY;
  for (const k of ['OPENAI_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY']) process.env[k] = 'test-key';
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

// ---------------------------------------------------------------------------------------------------------
// R229 Gemini system prompt
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

const geminiRest = {
  id: 'gemini-2.5-flash', modelId: 'gemini-2.5-flash', provider: 'google', reasoning: { supported: false },
  api: { pattern: 'generateContent', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', apiKeyEnvVar: 'GEMINI_API_KEY', authHeader: 'x-goog-api-key' },
} as unknown as ModelConfig;
const geminiSdk = { ...geminiRest, id: 'gemini-2.5-flash-sdk', modelId: 'gemini-2.5-flash-sdk', api: { ...geminiRest.api, pattern: 'google-sdk' } } as unknown as ModelConfig;

function gemReq(withTools: boolean): PreparedRequest {
  return {
    messages: [{ role: 'user', parts: [{ text: 'hello' }] }], headers: {}, parameters: { generationConfig: { maxOutputTokens: 64 } },
    modelId: 'gemini-2.5-flash', systemMessage: 'GEMINI SYSTEM PROMPT',
    tools: withTools ? [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} }, input_schema: { type: 'object', properties: {} } }] : [],
  } as unknown as PreparedRequest;
}

async function drain(s: any) { try { for await (const _c of s.chunks) { /* drain */ } await s.finalMessage; } catch { /* body captured already */ } }

describe('R229 CORTEX_GEMINI_SYSTEM_FIX', () => {
  it('REST generateContent (tools): off = no system_instruction (the defect); on = system_instruction {parts:[{text}]}', async () => {
    let calls = captureFetch();
    await (new APIClient() as any).sendRequest(gemReq(true), geminiRest);
    expect(calls[0]!.body.system_instruction).toBeUndefined();
    const offBody = calls[0]!.body;
    process.env.CORTEX_GEMINI_SYSTEM_FIX = 'off';
    calls = captureFetch();
    await (new APIClient() as any).sendRequest(gemReq(true), geminiRest);
    expect(JSON.stringify(calls[0]!.body)).toBe(JSON.stringify(offBody));

    process.env.CORTEX_GEMINI_SYSTEM_FIX = 'on';
    calls = captureFetch();
    await (new APIClient() as any).sendRequest(gemReq(true), geminiRest);
    expect(calls[0]!.body.system_instruction).toEqual({ parts: [{ text: 'GEMINI SYSTEM PROMPT' }] });
    const { system_instruction: _s, ...rest } = calls[0]!.body;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(offBody)); // only the system prompt added
  });

  it('generateContent without tools: off = old SDK on v1 (no system prompt); on = v1beta REST with system_instruction', async () => {
    let calls = captureFetch();
    await (new APIClient() as any).sendRequest(gemReq(false), geminiRest);
    expect(calls[0]!.url).toContain('/v1/models/');
    expect(JSON.stringify(calls[0]!.body)).not.toContain('GEMINI SYSTEM PROMPT');

    process.env.CORTEX_GEMINI_SYSTEM_FIX = 'on';
    calls = captureFetch();
    await (new APIClient() as any).sendRequest(gemReq(false), geminiRest);
    expect(calls[0]!.url).toContain('/v1beta/models/gemini-2.5-flash:generateContent');
    expect(calls[0]!.body.system_instruction).toEqual({ parts: [{ text: 'GEMINI SYSTEM PROMPT' }] });
  });

  it('streaming generateContent without tools: on = v1beta REST stream with system_instruction', async () => {
    let calls = captureFetch(true);
    await drain((new APIClient() as any).streamRequest(gemReq(false), geminiRest));
    expect(JSON.stringify(calls[0]!.body)).not.toContain('GEMINI SYSTEM PROMPT');
    process.env.CORTEX_GEMINI_SYSTEM_FIX = 'on';
    calls = captureFetch(true);
    await drain((new APIClient() as any).streamRequest(gemReq(false), geminiRest));
    expect(calls[0]!.url).toContain(':streamGenerateContent');
    expect(calls[0]!.body.system_instruction).toEqual({ parts: [{ text: 'GEMINI SYSTEM PROMPT' }] });
  });

  it('@google/genai SDK (google-sdk): off = top-level field DROPPED by the SDK; on = config.systemInstruction reaches the wire', async () => {
    let calls = captureFetch();
    await (new APIClient() as any).sendRequest(gemReq(true), geminiSdk);
    expect(JSON.stringify(calls[0]!.body)).not.toContain('GEMINI SYSTEM PROMPT');
    process.env.CORTEX_GEMINI_SYSTEM_FIX = 'on';
    calls = captureFetch();
    await (new APIClient() as any).sendRequest(gemReq(true), geminiSdk);
    expect(calls[0]!.body.systemInstruction?.parts?.[0]?.text).toBe('GEMINI SYSTEM PROMPT');
  });

  it('@google/genai SDK streaming: on = config.systemInstruction reaches the wire', async () => {
    let calls = captureFetch(true);
    await drain((new APIClient() as any).streamRequest(gemReq(true), geminiSdk));
    expect(JSON.stringify(calls[0]!.body)).not.toContain('GEMINI SYSTEM PROMPT');
    process.env.CORTEX_GEMINI_SYSTEM_FIX = 'on';
    calls = captureFetch(true);
    await drain((new APIClient() as any).streamRequest(gemReq(true), geminiSdk));
    expect(calls[0]!.body.systemInstruction?.parts?.[0]?.text).toBe('GEMINI SYSTEM PROMPT');
  });
});

// ---------------------------------------------------------------------------------------------------------
// R230 stable tool order (xAI hybrid server-side tools)
// ---------------------------------------------------------------------------------------------------------
describe('R230 CORTEX_STABLE_TOOL_ORDER', () => {
  const tools = [
    { name: 'Bash', description: 'b', input_schema: { type: 'object' } },
    { name: 'Read', description: 'r', input_schema: { type: 'object' } },
    { name: 'web_search', description: 'w', input_schema: { type: 'object' } },
  ] as any[];
  it('off = server tools moved first (the per-user-turn reorder); on = the caller order', () => {
    process.env.ENABLE_SERVER_SIDE_TOOLS = 'true';
    expect((grok43 as any).serverSideTools?.supported).toBe(true);
    const off = shouldUseServerSideTools(grok43, tools);
    expect(off.useServerSideTools).toBe(true);
    expect(off.tools.map((t) => t.name)).toEqual(['web_search', 'Bash', 'Read']);
    process.env.CORTEX_STABLE_TOOL_ORDER = 'on';
    const on = shouldUseServerSideTools(grok43, tools);
    expect(on.apiPattern).toBe('responses');
    expect(on.tools.map((t) => t.name)).toEqual(['Bash', 'Read', 'web_search']);
  });
});

// ---------------------------------------------------------------------------------------------------------
// R225 OpenAI prompt_cache_key
// ---------------------------------------------------------------------------------------------------------
const okChat = { id: 'c', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
const okResp = { id: 'r1', object: 'response', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } };
const openaiChat = { id: 'gpt-4.1', modelId: 'gpt-4.1', provider: 'openai', reasoning: { supported: false },
  api: { pattern: 'chat/completions', endpoint: 'https://api.openai.com/v1/chat/completions', apiKeyEnvVar: 'OPENAI_API_KEY' } } as unknown as ModelConfig;
const openaiResp = { ...openaiChat, api: { pattern: 'responses', endpoint: 'https://api.openai.com/v1/responses', apiKeyEnvVar: 'OPENAI_API_KEY' } } as unknown as ModelConfig;
const deepseekChat = { ...openaiChat, provider: 'deepseek', api: { pattern: 'chat/completions', endpoint: 'https://api.deepseek.com/chat/completions', apiKeyEnvVar: 'DEEPSEEK_API_KEY' } } as unknown as ModelConfig;
function chatReq(): PreparedRequest {
  return { messages: [{ role: 'user', content: 'hi' }], tools: [], headers: {}, parameters: { max_tokens: 16 }, modelId: 'm', conversationId: 'sess-123' } as unknown as PreparedRequest;
}

describe('R225 CORTEX_OPENAI_CACHE_KEY', () => {
  it('chat/completions: off = no key (byte-identical); on = prompt_cache_key = session id; non-OpenAI never', async () => {
    chatCreate.mockResolvedValue(okChat);
    await (new APIClient() as any).sendRequest(chatReq(), openaiChat);
    const off = chatCreate.mock.calls[0][0];
    expect(off.prompt_cache_key).toBeUndefined();
    process.env.CORTEX_OPENAI_CACHE_KEY = 'on';
    await (new APIClient() as any).sendRequest(chatReq(), openaiChat);
    const on = chatCreate.mock.calls[1][0];
    expect(on.prompt_cache_key).toBe('sess-123');
    const { prompt_cache_key: _k, ...rest } = on;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(off));
    await (new APIClient() as any).sendRequest(chatReq(), deepseekChat);
    expect(chatCreate.mock.calls[2][0].prompt_cache_key).toBeUndefined();
  });

  it('Responses (OpenAI): off = no key; on = prompt_cache_key', async () => {
    responsesCreate.mockResolvedValue(okResp);
    const req = () => ({ ...chatReq(), messages: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }], parameters: { max_output_tokens: 16 } }) as any;
    await (new APIClient() as any).sendRequest(req(), openaiResp);
    expect(responsesCreate.mock.calls[0][0].prompt_cache_key).toBeUndefined();
    process.env.CORTEX_OPENAI_CACHE_KEY = 'on';
    await (new APIClient() as any).sendRequest(req(), openaiResp);
    expect(responsesCreate.mock.calls[1][0].prompt_cache_key).toBe('sess-123');
  });
});

// ---------------------------------------------------------------------------------------------------------
// R225 Anthropic automatic cache_control + TTL
// ---------------------------------------------------------------------------------------------------------
function anthropicMessages(): any[] {
  return [
    { role: 'user', content: [{ type: 'text', text: 'Fix the bug.' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
  ];
}
const anthropicModel = {
  id: 'claude-sonnet-4.6', modelId: 'claude-sonnet-4-6', provider: 'anthropic', family: 'claude-4.6',
  reasoning: { supported: false }, api: { pattern: 'messages', endpoint: 'x', apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
} as unknown as ModelConfig;
function anthReq(): PreparedRequest {
  return {
    messages: anthropicMessages(), headers: {}, parameters: { max_tokens: 64 }, modelId: 'claude-sonnet-4-6',
    systemMessage: 'SYS', tools: [{ name: 'Bash', input_schema: { type: 'object' } }, { name: 'Read', input_schema: { type: 'object' } }],
  } as unknown as PreparedRequest;
}
function anthClient() {
  const create = vi.fn(async () => ({ id: 'm', content: [], stop_reason: 'end_turn', usage: {} }));
  const stream = vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {}, finalMessage: async () => ({}) }));
  const client: any = new APIClient();
  client.anthropicClient = { messages: { create, stream } };
  return { client, create, stream };
}

describe('R225 CORTEX_ANTHROPIC_AUTO_CACHE / CORTEX_ANTHROPIC_CACHE_TTL', () => {
  it('off = byte-identical (no top-level cache_control, no ttl); explicit "off"/"5m" too', async () => {
    const a = anthClient();
    await a.client.sendRequest(anthReq(), anthropicModel);
    const off = a.create.mock.calls[0][0];
    expect(off.cache_control).toBeUndefined();
    expect(JSON.stringify(off)).not.toContain('"ttl"');
    process.env.CORTEX_ANTHROPIC_AUTO_CACHE = 'off';
    process.env.CORTEX_ANTHROPIC_CACHE_TTL = '5m';
    await a.client.sendRequest(anthReq(), anthropicModel);
    expect(JSON.stringify(a.create.mock.calls[1][0])).toBe(JSON.stringify(off));
  });

  it('auto on: top-level automatic cache_control beside system + last-tool markers (3 <= 4)', async () => {
    process.env.CORTEX_ANTHROPIC_AUTO_CACHE = 'on';
    const a = anthClient();
    await a.client.sendRequest(anthReq(), anthropicModel);
    const on = a.create.mock.calls[0][0];
    expect(on.cache_control).toEqual({ type: 'ephemeral' });
    expect(on.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(countAnthropicBreakpoints(on) + 1).toBeLessThanOrEqual(4);
  });

  it('auto + R218 history: cap full (system + tool + 2 history) → no automatic marker (would 400)', async () => {
    process.env.CORTEX_ANTHROPIC_AUTO_CACHE = 'on';
    process.env.CORTEX_ANTHROPIC_HISTORY_CACHE = 'on';
    const msgs = [...anthropicMessages(), { role: 'assistant', content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok2' }] }];
    const a = anthClient();
    await a.client.sendRequest({ ...anthReq(), messages: msgs } as any, anthropicModel);
    const on = a.create.mock.calls[0][0];
    expect(countAnthropicBreakpoints(on)).toBe(4);
    expect(on.cache_control).toBeUndefined();
  });

  it('TTL 1h: every marker (system, tool, history, automatic) carries ttl 1h; input messages never mutated', async () => {
    process.env.CORTEX_ANTHROPIC_AUTO_CACHE = 'on';
    process.env.CORTEX_ANTHROPIC_CACHE_TTL = '1h';
    process.env.CORTEX_ANTHROPIC_HISTORY_CACHE = 'on';
    const req = anthReq();
    const before = JSON.stringify(req.messages);
    const a = anthClient();
    await a.client.sendRequest(req, anthropicModel);
    const on = a.create.mock.calls[0][0];
    expect(JSON.stringify(req.messages)).toBe(before);
    const ccs = JSON.stringify(on).match(/"cache_control":\{[^}]*\}/g) ?? [];
    expect(ccs.length).toBeGreaterThanOrEqual(3);
    for (const c of ccs) expect(c).toContain('"ttl":"1h"');
  });

  it('stream path applies the same levers; xAI Messages branch untouched', async () => {
    process.env.CORTEX_ANTHROPIC_AUTO_CACHE = 'on';
    process.env.CORTEX_ANTHROPIC_CACHE_TTL = '1h';
    const a = anthClient();
    a.client.streamRequest(anthReq(), anthropicModel);
    expect(a.stream.mock.calls[0][0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    const body = { id: 'm', type: 'message', content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn', usage: {} };
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) }));
    vi.stubGlobal('fetch', fetchSpy);
    const xaiMessages = { ...anthropicModel, provider: 'xai', modelId: 'grok-4.3',
      api: { pattern: 'messages', endpoint: 'https://api.x.ai/v1/messages', apiKeyEnvVar: 'XAI_API_KEY' } } as unknown as ModelConfig;
    await (new APIClient() as any).sendRequest(anthReq(), xaiMessages);
    const sent = JSON.parse((fetchSpy.mock.calls.at(-1) as any)[1].body);
    expect(sent.cache_control).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain('"ttl"');
  });

  it('helper: ANTHROPIC_PROMPT_CACHING=false path never calls it; helper alone respects the cap', () => {
    process.env.CORTEX_ANTHROPIC_AUTO_CACHE = 'on';
    const full: any = { system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }], tools: [{ name: 't', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } }] }] };
    expect(applyAnthropicCacheLevers(full).auto).toBe(false);
    expect(full.cache_control).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------
// R225 forced tool_choice keeps the full tools array
// ---------------------------------------------------------------------------------------------------------
describe('R225 CORTEX_FORCED_CHOICE_FULL_TOOLS', () => {
  const tools = [
    { name: 'Bash', description: 'b', schema: { type: 'object', properties: {} } },
    { name: 'AskForAdvice', description: 'a', schema: { type: 'object', properties: {} } },
    { name: 'Read', description: 'r', schema: { type: 'object', properties: {} } },
  ] as any[];
  const msgs = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] as any[];
  it('off = tools narrowed to the forced tool; on = full array + the same tool_choice', () => {
    const gw = new GatewayTranslationLayer();
    const off = gw.prepareRequest(msgs, tools, deepseekV4Flash, { toolChoice: { type: 'tool', name: 'AskForAdvice' } } as any);
    const names = (r: any) => r.tools.map((t: any) => t.function?.name ?? t.name);
    expect(names(off)).toHaveLength(1);
    process.env.CORTEX_FORCED_CHOICE_FULL_TOOLS = 'on';
    const on = gw.prepareRequest(msgs, tools, deepseekV4Flash, { toolChoice: { type: 'tool', name: 'AskForAdvice' } } as any);
    expect(names(on)).toHaveLength(3);
    expect(JSON.stringify(on.toolChoice)).toBe(JSON.stringify(off.toolChoice));
    const plain = gw.prepareRequest(msgs, tools, deepseekV4Flash, {} as any);
    expect(JSON.stringify(on.tools)).toBe(JSON.stringify(plain.tools)); // same tools prefix as an unforced request
  });
});

// ---------------------------------------------------------------------------------------------------------
// R224a streaming chat usage
// ---------------------------------------------------------------------------------------------------------
describe('R224a CORTEX_STREAM_USAGE', () => {
  const chunks = [
    { id: 's1', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'he' }, finish_reason: null }] },
    { id: 's1', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'llo' }, finish_reason: 'stop' }] },
    { id: 's1', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 } },
  ];
  function streamOf(list: any[]) { return { async *[Symbol.asyncIterator]() { for (const c of list) yield c; } }; }

  it('R236: unset = include_usage requested for deepseek (default on); explicit on = same; explicit off = no stream_options and zero usage', async () => {
    chatCreate.mockImplementation(async () => streamOf(chunks));
    let s = (new APIClient() as any).streamRequest(chatReq(), deepseekChat);
    for await (const _c of s.chunks) { /* drain */ }
    let fin = await s.finalMessage;
    expect(chatCreate.mock.calls[0][0].stream_options).toEqual({ include_usage: true }); // R236 default on for deepseek
    expect(fin.usage.prompt_tokens).toBe(100); // the provider usage is carried by default now
    expect(fin.choices[0].message.content).toBe('hello');

    process.env.CORTEX_STREAM_USAGE = 'off'; // explicit off = the pre-R236 behaviour
    s = (new APIClient() as any).streamRequest(chatReq(), deepseekChat);
    for await (const _c of s.chunks) { /* drain */ }
    fin = await s.finalMessage;
    expect(chatCreate.mock.calls[1][0].stream_options).toBeUndefined();
    expect(fin.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

    process.env.CORTEX_STREAM_USAGE = 'on';
    s = (new APIClient() as any).streamRequest(chatReq(), deepseekChat);
    for await (const _c of s.chunks) { /* drain */ }
    fin = await s.finalMessage;
    expect(chatCreate.mock.calls[2][0].stream_options).toEqual({ include_usage: true });
    expect(fin.usage.prompt_cache_hit_tokens).toBe(64);
    expect(fin.usage.prompt_tokens).toBe(100);
    expect(fin.choices[0].message.content).toBe('hello');
    expect(fin.choices[0].finish_reason).toBe('stop');
  });

  it('non-streaming chat never gets stream_options', async () => {
    process.env.CORTEX_STREAM_USAGE = 'on';
    chatCreate.mockResolvedValue(okChat);
    await (new APIClient() as any).sendRequest(chatReq(), deepseekChat);
    expect(chatCreate.mock.calls[0][0].stream_options).toBeUndefined();
  });

  it('helper: missing usage → legacy zeros', () => {
    expect(streamFinalUsage(null)).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });
});
