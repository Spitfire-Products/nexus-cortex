/**
 * R63: static system prompt delivery on the chat/completions + Responses paths.
 *
 * The R28 split routes ALL static system content (system_prompt, tool guides,
 * CLAUDE.md, memory) into PreparedRequest.systemMessage. Messages/Anthropic and
 * Gemini paths consume it; the chat/completions builder and the Responses
 * assembly did NOT — so every chat/completions provider (DeepSeek, OpenAI chat
 * cards, Groq, hf-space which reuses the builder) received ZERO system prompt
 * from 2026-05-16 (R28f) until this fix, and OpenAI Responses got only
 * reminder text mined from user messages (empty post-R28f).
 *
 * Contract:
 *  - chat/completions: request.systemMessage → messages[0] {role:'system'}
 *    (system-first keeps the provider's automatic prefix cache stable).
 *  - Responses non-XAI: systemMessage merges into `instructions` (first).
 *  - Responses XAI: no `instructions` support — systemMessage becomes a
 *    system-role input item at chain start ONLY (previous_response_id chains
 *    already hold it server-side).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sdkResponsesCreate = vi.fn();
const sdkChatCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    responses = { create: sdkResponsesCreate };
    chat = { completions: { create: sdkChatCreate } };
    constructor(_opts: unknown) {}
  },
}));

import { APIClient } from '../APIClient.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import type { PreparedRequest } from '../../adapters/GatewayTranslationLayer.js';

const deepseekModel = {
  id: 'deepseek-v4-flash',
  modelId: 'deepseek-chat',
  provider: 'deepseek',
  reasoning: { supported: false },
  tools: { supported: true },
  api: {
    pattern: 'chat/completions',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
  },
} as unknown as ModelConfig;

const xaiResponsesModel = {
  modelId: 'grok-4.3',
  provider: 'xai',
  reasoning: { supported: true },
  api: {
    pattern: 'responses',
    endpoint: 'https://api.x.ai/v1/responses',
    apiKeyEnvVar: 'XAI_API_KEY',
  },
} as unknown as ModelConfig;

const baseRequest = (overrides: Partial<PreparedRequest> = {}): PreparedRequest => ({
  messages: [{ type: 'message', role: 'user', content: 'hi' }] as any,
  tools: [],
  headers: {},
  parameters: { max_tokens: 16 },
  modelId: 'deepseek-v4-flash',
  ...overrides,
});

const fakeXaiResponseBody = {
  id: 'resp_test',
  object: 'response',
  model: 'grok-4.3',
  output: [
    { id: 'msg_1', type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: 'hello back' }] },
  ],
  usage: { input_tokens: 5, output_tokens: 2 },
};

describe('chat/completions delivers the static system prompt (R63, opt-in)', () => {
  const prevKey = process.env.DEEPSEEK_API_KEY;
  const prevFlag = process.env.CORTEX_DELIVER_SYSTEM_PROMPT;
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-ds-key';
    process.env.CORTEX_DELIVER_SYSTEM_PROMPT = 'true';
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevKey;
    if (prevFlag === undefined) delete process.env.CORTEX_DELIVER_SYSTEM_PROMPT;
    else process.env.CORTEX_DELIVER_SYSTEM_PROMPT = prevFlag;
  });

  it('OPT-IN GATE: without the flag, delivery is OFF (published legacy behavior preserved)', () => {
    delete process.env.CORTEX_DELIVER_SYSTEM_PROMPT;
    const client = new APIClient() as any;
    const { chatRequest } = client.buildChatCompletionsRequest(
      baseRequest({ systemMessage: 'SHOULD NOT APPEAR' }),
      deepseekModel,
      { stream: false },
    );
    expect(chatRequest.messages).toHaveLength(1);
    expect(chatRequest.messages[0].role).toBe('user');
  });

  it('prepends systemMessage as messages[0] role:system', () => {
    const client = new APIClient() as any;
    const { chatRequest } = client.buildChatCompletionsRequest(
      baseRequest({ systemMessage: 'You are Cortex. GUIDES HERE.' }),
      deepseekModel,
      { stream: false },
    );
    expect(chatRequest.messages[0]).toEqual({
      role: 'system',
      content: 'You are Cortex. GUIDES HERE.',
    });
    expect(chatRequest.messages).toHaveLength(2);
    expect(chatRequest.messages[1].role).toBe('user');
  });

  it('leaves messages untouched when no systemMessage is set', () => {
    const client = new APIClient() as any;
    const { chatRequest } = client.buildChatCompletionsRequest(
      baseRequest(),
      deepseekModel,
      { stream: false },
    );
    expect(chatRequest.messages).toHaveLength(1);
    expect(chatRequest.messages[0].role).toBe('user');
  });

  it('streaming variant gets the same system message', () => {
    const client = new APIClient() as any;
    const { chatRequest } = client.buildChatCompletionsRequest(
      baseRequest({ systemMessage: 'SYS' }),
      deepseekModel,
      { stream: true },
    );
    expect(chatRequest.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(chatRequest.stream).toBe(true);
  });
});

describe('xAI Responses delivers systemMessage as chain-start system input item (R63, opt-in)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const prevKey = process.env.XAI_API_KEY;
  const prevFlag2 = process.env.CORTEX_DELIVER_SYSTEM_PROMPT;

  beforeEach(() => {
    sdkResponsesCreate.mockReset();
    process.env.XAI_API_KEY = 'test-xai-key';
    process.env.CORTEX_DELIVER_SYSTEM_PROMPT = 'true';
    fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => fakeXaiResponseBody,
      text: async () => JSON.stringify(fakeXaiResponseBody),
    }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevKey;
    if (prevFlag2 === undefined) delete process.env.CORTEX_DELIVER_SYSTEM_PROMPT;
    else process.env.CORTEX_DELIVER_SYSTEM_PROMPT = prevFlag2;
  });

  it('injects a system input item at chain start (no previous_response_id)', async () => {
    const client = new APIClient();
    await client.sendRequest(
      baseRequest({ modelId: 'grok-4.3', parameters: { max_output_tokens: 16 }, systemMessage: 'SYS-XAI' }),
      xaiResponsesModel,
    );
    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.instructions).toBeUndefined();
    expect(sentBody.input[0]).toEqual({ role: 'system', content: 'SYS-XAI' });
  });

  it('does NOT re-inject on previous_response_id continuations', async () => {
    const client = new APIClient();
    await client.sendRequest(
      baseRequest({
        modelId: 'grok-4.3',
        parameters: { max_output_tokens: 16 },
        systemMessage: 'SYS-XAI',
        previousResponseId: 'resp_prev',
      } as any),
      xaiResponsesModel,
    );
    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const systemItems = (sentBody.input as any[]).filter(i => i.role === 'system');
    expect(systemItems).toHaveLength(0);
    expect(sentBody.previous_response_id).toBe('resp_prev');
  });
});
