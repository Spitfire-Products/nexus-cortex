/**
 * xAI Responses API transport.
 *
 * The OpenAI SDK's client.responses.create() produces a request xAI's
 * /v1/responses route rejects (404 "No handler found on route") and a
 * response shape the adapter cannot convert (empty content). A raw fetch with
 * Bearer auth works where the SDK does not.
 *
 * Contract: for an xAI model on the responses pattern, sendResponsesAPI MUST
 * issue a raw fetch to the configured /v1/responses endpoint with
 * `Authorization: Bearer <key>` and MUST NOT route through the OpenAI SDK.
 * OpenAI's own Responses path is unaffected (still SDK).
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
import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import type { PreparedRequest } from '../../adapters/GatewayTranslationLayer.js';

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

const minimalRequest: PreparedRequest = {
  messages: [{ type: 'message', role: 'user', content: 'hi' }],
  tools: [],
  headers: {},
  parameters: { max_output_tokens: 16 },
  modelId: 'grok-4.3',
};

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

describe('xAI Responses transport uses raw fetch, not the OpenAI SDK', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const prevKey = process.env.XAI_API_KEY;

  beforeEach(() => {
    sdkResponsesCreate.mockReset();
    process.env.XAI_API_KEY = 'test-xai-key';
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
  });

  it('POSTs raw fetch to the xAI /v1/responses endpoint with Bearer auth', async () => {
    const client = new APIClient();
    const res = await client.sendRequest(minimalRequest, xaiResponsesModel);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/responses');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-xai-key');
    expect(headers['Content-Type']).toBe('application/json');
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.model).toBe('grok-4.3');

    // Must NOT route xAI through the OpenAI SDK (the broken path)
    expect(sdkResponsesCreate).not.toHaveBeenCalled();

    expect(res.status).toBe(200);
    expect((res.data as { id: string }).id).toBe('resp_test');
  });
});
