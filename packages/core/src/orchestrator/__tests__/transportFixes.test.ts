/**
 * R215 / R216 / R218 transport fixes (2026-10-02). Each DARK flag: off = byte-identical request,
 * on = the fixed shape. Request bodies are captured at the SDK / fetch boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sdkResponsesCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    responses = { create: sdkResponsesCreate };
    constructor(_opts: unknown) {}
  },
}));

import { APIClient } from '../APIClient.js';
import { GatewayTranslationLayer } from '../../adapters/GatewayTranslationLayer.js';
import { classifyEmptyResponse, isReasoningExhaustion } from '../emptyResponseClassifier.js';
import {
  inlineRemindersForResponses,
  mapResponsesStopReason,
  mapHFSpaceStopReason,
  applyAnthropicHistoryCache,
  countAnthropicBreakpoints,
  ANTHROPIC_MAX_CACHE_BREAKPOINTS,
} from '../transportFixes.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import type { PreparedRequest } from '../../adapters/GatewayTranslationLayer.js';

const FLAGS = ['CORTEX_RESPONSES_INLINE_REMINDERS', 'CORTEX_RESPONSES_STOP_REASON', 'CORTEX_ANTHROPIC_HISTORY_CACHE'] as const;
const saved: Record<string, string | undefined> = {};
const KEYS = ['OPENAI_API_KEY', 'XAI_API_KEY', 'ANTHROPIC_PROMPT_CACHING', 'CORTEX_DELIVER_SYSTEM_PROMPT'];

beforeEach(() => {
  for (const k of [...FLAGS, ...KEYS]) saved[k] = process.env[k];
  for (const k of FLAGS) delete process.env[k];
  delete process.env.ANTHROPIC_PROMPT_CACHING;
  delete process.env.CORTEX_DELIVER_SYSTEM_PROMPT;
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.XAI_API_KEY = 'test-xai';
  sdkResponsesCreate.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of [...FLAGS, ...KEYS]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const REM = '<system-reminder>\nLIFT PLAN: run the tests next.\n</system-reminder>';

/** Shape the ResponsesAPIAdapter emits for a canonical user message [tool_result, text(reminder)]. */
function toolLoopInput(): any[] {
  return [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the bug.' }] },
    { type: 'function_call', call_id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: REM }] },
    { type: 'function_call_output', call_id: 'call_1', output: 'a.txt' },
  ];
}

const openaiResponses = {
  modelId: 'gpt-5.1', provider: 'openai', reasoning: { supported: false },
  api: { pattern: 'responses', endpoint: 'https://api.openai.com/v1/responses', apiKeyEnvVar: 'OPENAI_API_KEY' },
} as unknown as ModelConfig;
const xaiResponses = {
  modelId: 'grok-4.3', provider: 'xai', reasoning: { supported: false },
  api: { pattern: 'responses', endpoint: 'https://api.x.ai/v1/responses', apiKeyEnvVar: 'XAI_API_KEY' },
} as unknown as ModelConfig;

function respReq(): PreparedRequest {
  return {
    messages: toolLoopInput(), tools: [], headers: {}, parameters: { max_output_tokens: 64 },
    modelId: 'm', systemMessage: 'STATIC SYSTEM PROMPT',
  } as PreparedRequest;
}

const okBody = { id: 'r1', object: 'response', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } };

async function openaiBody(): Promise<any> {
  sdkResponsesCreate.mockResolvedValueOnce(okBody);
  await (new APIClient() as any).sendRequest(respReq(), openaiResponses);
  return sdkResponsesCreate.mock.calls.at(-1)![0];
}

async function xaiBody(): Promise<any> {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => okBody, text: async () => '' }));
  vi.stubGlobal('fetch', fetchSpy);
  await (new APIClient() as any).sendRequest(respReq(), xaiResponses);
  return JSON.parse((fetchSpy.mock.calls.at(-1) as any)[1].body);
}

// ---------------------------------------------------------------------------------------------------------
describe('R215 CORTEX_RESPONSES_INLINE_REMINDERS', () => {
  it('helper: moves the reminder-carrying user item after its function_call_output, nothing dropped', () => {
    const out = inlineRemindersForResponses(toolLoopInput());
    expect(out.map((i) => i.type)).toEqual(['message', 'function_call', 'function_call_output', 'message']);
    expect(out[3].content[0].text).toBe(REM);
    expect(inlineRemindersForResponses([])).toEqual([]);
  });

  it('OpenAI: off (unset) = legacy extraction; explicit "off" is byte-identical', async () => {
    const unset = await openaiBody();
    expect(unset.instructions).toBe('STATIC SYSTEM PROMPT\n\nLIFT PLAN: run the tests next.');
    expect(JSON.stringify(unset.input)).not.toContain('system-reminder');
    process.env.CORTEX_RESPONSES_INLINE_REMINDERS = 'off';
    const off = await openaiBody();
    expect(JSON.stringify(off)).toBe(JSON.stringify(unset));
  });

  it('OpenAI: on = reminder stays inline after the tool output; instructions carry only the system prompt (R63)', async () => {
    process.env.CORTEX_RESPONSES_INLINE_REMINDERS = 'on';
    const body = await openaiBody();
    expect(body.instructions).toBe('STATIC SYSTEM PROMPT');
    expect(body.input.map((i: any) => i.type)).toEqual(['message', 'function_call', 'function_call_output', 'message']);
    expect(body.input[3]).toEqual({ type: 'message', role: 'user', content: [{ type: 'input_text', text: REM }] });
  });

  it('xAI: off drops the reminder (pre-existing defect); on delivers it inline', async () => {
    const off = await xaiBody();
    expect(off.instructions).toBeUndefined();
    expect(JSON.stringify(off)).not.toContain('LIFT PLAN');
    process.env.CORTEX_RESPONSES_INLINE_REMINDERS = 'on';
    const on = await xaiBody();
    expect(on.instructions).toBeUndefined();
    // R63 xAI delivery unchanged: system-role item at chain start, then the in-order conversation.
    expect(on.input[0]).toEqual({ role: 'system', content: 'STATIC SYSTEM PROMPT' });
    expect(on.input.slice(1).map((i: any) => i.type)).toEqual(['message', 'function_call', 'function_call_output', 'message']);
    expect(on.input[4].content[0].text).toBe(REM);
  });

  it('streaming OpenAI path carries the same inline shape', async () => {
    process.env.CORTEX_RESPONSES_INLINE_REMINDERS = 'on';
    sdkResponsesCreate.mockResolvedValueOnce((async function* () { yield { type: 'response.completed', response: okBody }; })());
    const sr = (new APIClient() as any).streamRequest(respReq(), openaiResponses);
    for await (const _ of sr.chunks) { /* drain */ }
    const body = sdkResponsesCreate.mock.calls.at(-1)![0];
    expect(body.instructions).toBe('STATIC SYSTEM PROMPT');
    expect(body.input[3].content[0].text).toBe(REM);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Live DeepSeek shapes recorded 2026-10-02 (api.deepseek.com/responses, max_output_tokens 8).
const LIVE_INCOMPLETE = { object: 'response', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
  output: [{ type: 'reasoning', status: 'incomplete', content: [{ type: 'reasoning_text', text: 'We need ans' }] }] };
const LIVE_COMPLETED = { object: 'response', status: 'completed', incomplete_details: null, output: [] };

describe('R216 CORTEX_RESPONSES_STOP_REASON', () => {
  const gtl = new GatewayTranslationLayer();
  const stop = (resp: any, pattern: string) =>
    (gtl as any).extractStopReason(resp, { api: { pattern } } as any);

  it('mapping helpers', () => {
    expect(mapResponsesStopReason(LIVE_INCOMPLETE)).toBe('max_output_tokens');
    expect(mapResponsesStopReason(LIVE_COMPLETED)).toBe('completed');
    expect(mapResponsesStopReason({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } })).toBe('content_filter');
    expect(mapResponsesStopReason({ status: 'incomplete' })).toBe('incomplete');
    expect(mapResponsesStopReason(undefined)).toBeUndefined();
    expect(mapHFSpaceStopReason({ choices: [{ finish_reason: 'stop' }] })).toBe('stop');
    expect(mapHFSpaceStopReason({})).toBeUndefined();
  });

  it('off: responses + hf-space stay undefined (pre-existing)', () => {
    expect(stop(LIVE_INCOMPLETE, 'responses')).toBeUndefined();
    expect(stop({ choices: [{ finish_reason: 'length' }] }, 'hf-space')).toBeUndefined();
  });

  it('on: truncation reaches the classifier as truncated → reasoning exhaustion', () => {
    process.env.CORTEX_RESPONSES_STOP_REASON = 'on';
    const sr = stop(LIVE_INCOMPLETE, 'responses');
    expect(sr).toBe('max_output_tokens');
    const cls = classifyEmptyResponse([{ type: 'thinking', thinking: 'We need ans' }], sr);
    expect(cls.kind).toBe('truncated');
    expect(isReasoningExhaustion(cls)).toBe(true);
    expect(stop(LIVE_COMPLETED, 'responses')).toBe('completed');
    expect(stop({ choices: [{ finish_reason: 'length' }] }, 'hf-space')).toBe('length');
    // other patterns untouched
    expect(stop({ stop_reason: 'max_tokens' }, 'messages')).toBe('max_tokens');
  });

  async function streamFinal(): Promise<any> {
    sdkResponsesCreate.mockResolvedValueOnce((async function* () {
      yield { type: 'response.created', response: { id: 'r2', status: 'in_progress' } };
      yield { type: 'response.incomplete', response: { id: 'r2', ...LIVE_INCOMPLETE } };
    })());
    const sr = (new APIClient() as any).streamRequest(respReq(), openaiResponses);
    for await (const _ of sr.chunks) { /* drain */ }
    return sr.finalMessage;
  }

  it('streaming: off = finalMessage has no status (pre-existing); on = response.incomplete status carried', async () => {
    const off = await streamFinal();
    expect(off.status).toBeUndefined();
    expect(stop(off, 'responses')).toBeUndefined();
    process.env.CORTEX_RESPONSES_STOP_REASON = 'on';
    const on = await streamFinal();
    expect(on.status).toBe('incomplete');
    expect(on.incomplete_details).toEqual({ reason: 'max_output_tokens' });
    expect(stop(on, 'responses')).toBe('max_output_tokens');
  });
});

// ---------------------------------------------------------------------------------------------------------
function anthropicMessages(): any[] {
  return [
    { role: 'user', content: [{ type: 'text', text: 'Fix the bug.' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 't', signature: 's' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }, { type: 'text', text: REM }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok2' }, { type: 'text', text: '' }] },
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

describe('R218 CORTEX_ANTHROPIC_HISTORY_CACHE', () => {
  it('helper: prev + newest user messages, last markable block, never mutates input', () => {
    const msgs = anthropicMessages();
    const before = JSON.stringify(msgs);
    const { messages, added } = applyAnthropicHistoryCache(msgs, 2);
    expect(added).toBe(2);
    expect(JSON.stringify(msgs)).toBe(before);
    expect(messages[2].content[1].cache_control).toEqual({ type: 'ephemeral' }); // reminder text block
    expect(messages[4].content[0].cache_control).toEqual({ type: 'ephemeral' }); // empty text skipped → tool_result
    expect(messages[4].content[1].cache_control).toBeUndefined();
    expect(messages[0]).toBe(msgs[0]);
  });

  it('helper: cap respected — one slot → stable prefix only; none → untouched; existing markers counted', () => {
    const one = applyAnthropicHistoryCache(anthropicMessages(), 3);
    expect(one.added).toBe(1);
    expect(one.messages[2].content[1].cache_control).toBeDefined();
    expect(one.messages[4].content[0].cache_control).toBeUndefined();
    const none = applyAnthropicHistoryCache(anthropicMessages(), 4);
    expect(none.added).toBe(0);
    const pre = anthropicMessages();
    pre[0].content[0].cache_control = { type: 'ephemeral' };
    expect(applyAnthropicHistoryCache(pre, 2).added).toBe(1);
    const str = applyAnthropicHistoryCache([{ role: 'user', content: 'hi' }], 0);
    expect(str.messages[0].content).toEqual([{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }]);
  });

  it('send: off = byte-identical (no message breakpoints); on = total breakpoints <= 4', async () => {
    const a = anthClient();
    await a.client.sendRequest(anthReq(), anthropicModel);
    const off = a.create.mock.calls[0][0];
    expect(JSON.stringify(off.messages)).toBe(JSON.stringify(anthropicMessages()));
    process.env.CORTEX_ANTHROPIC_HISTORY_CACHE = 'off';
    await a.client.sendRequest(anthReq(), anthropicModel);
    expect(JSON.stringify(a.create.mock.calls[1][0])).toBe(JSON.stringify(off));

    process.env.CORTEX_ANTHROPIC_HISTORY_CACHE = 'on';
    await a.client.sendRequest(anthReq(), anthropicModel);
    const on = a.create.mock.calls[2][0];
    expect(countAnthropicBreakpoints(on)).toBe(ANTHROPIC_MAX_CACHE_BREAKPOINTS);
    expect(on.messages[2].content[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(on.messages[4].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('send: ANTHROPIC_PROMPT_CACHING=false disables it', async () => {
    process.env.CORTEX_ANTHROPIC_HISTORY_CACHE = 'on';
    process.env.ANTHROPIC_PROMPT_CACHING = 'false';
    const a = anthClient();
    await a.client.sendRequest(anthReq(), anthropicModel);
    expect(countAnthropicBreakpoints(a.create.mock.calls[0][0])).toBe(0);
  });

  it('stream: on = same breakpoints, cap respected', () => {
    process.env.CORTEX_ANTHROPIC_HISTORY_CACHE = 'on';
    const a = anthClient();
    a.client.streamRequest(anthReq(), anthropicModel);
    const body = a.stream.mock.calls[0][0];
    expect(countAnthropicBreakpoints(body)).toBeLessThanOrEqual(4);
    expect(body.messages[4].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('xAI Messages branch never gets message breakpoints', async () => {
    process.env.CORTEX_ANTHROPIC_HISTORY_CACHE = 'on';
    const body = { id: 'm', type: 'message', content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn', usage: {} };
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) }));
    vi.stubGlobal('fetch', fetchSpy);
    const xaiMessages = { ...anthropicModel, provider: 'xai', modelId: 'grok-4.3',
      api: { pattern: 'messages', endpoint: 'https://api.x.ai/v1/messages', apiKeyEnvVar: 'XAI_API_KEY' } } as unknown as ModelConfig;
    await (new APIClient() as any).sendRequest(anthReq(), xaiMessages);
    const sent = JSON.parse((fetchSpy.mock.calls.at(-1) as any)[1].body);
    expect(JSON.stringify(sent.messages)).not.toContain('cache_control');
  });
});
