/**
 * xAI returns the authoritative billed cost (`usage.cost_in_usd_ticks`) on
 * every response — including Responses API + agentic loops — covering the
 * otherwise-opaque server-side tool/reasoning spend. The gateway must surface
 * it (and num_server_side_tools_used) so cost is observable, not estimated.
 */
import { describe, it, expect } from 'vitest';
import { GatewayTranslationLayer } from '../GatewayTranslationLayer.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const gw = new GatewayTranslationLayer();
const xaiResponses = {
  id: 'grok-4.3', provider: 'xai',
  api: { pattern: 'responses', endpoint: 'https://api.x.ai/v1/responses' },
  tools: { adapter: 'ResponsesAPIAdapter' },
} as unknown as ModelConfig;
const ctx = { sessionId: 's', conversationId: 'c', turnNumber: 1 };

function resp(usage: Record<string, unknown>) {
  return {
    object: 'response', id: 'r1', model: 'grok-4.3',
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'hi' }] }],
    usage,
  };
}

describe('usage cost passthrough (xAI cost_in_usd_ticks)', () => {
  it('surfaces costUsdTicks, costUsd, and serverSideToolsUsed', () => {
    const r = gw.convertResponse(
      resp({ input_tokens: 199, output_tokens: 1, total_tokens: 200,
              cost_in_usd_ticks: 3381000, num_server_side_tools_used: 2 }),
      xaiResponses, ctx);
    expect(r.usage?.costUsdTicks).toBe(3381000);
    expect(r.usage?.costUsd).toBe(3381000 / 1e10); // 0.0003381
    expect(r.usage?.serverSideToolsUsed).toBe(2);
    expect(r.usage?.inputTokens).toBe(199);
  });

  it('omits cost fields when the provider does not report them (back-compat)', () => {
    const r = gw.convertResponse(
      resp({ input_tokens: 10, output_tokens: 2, total_tokens: 12 }),
      xaiResponses, ctx);
    expect(r.usage?.costUsdTicks).toBeUndefined();
    expect(r.usage?.costUsd).toBeUndefined();
    expect(r.usage?.serverSideToolsUsed).toBeUndefined();
    expect(r.usage?.inputTokens).toBe(10);
  });
});
