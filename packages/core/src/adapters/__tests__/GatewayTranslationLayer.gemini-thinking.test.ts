/**
 * Gemini tunable thinking (thinking_level) plumb — card-level opt-in.
 *
 * gemini-3.6/3.7-flash support thinking_level low|medium|high (API default
 * medium). A card opts in via createGeminiModelConfig({ thinkingLevel }) which
 * lands in reasoning.defaultEffort; the gateway translates it to
 * generationConfig.thinkingConfig.thinkingLevel on generateContent requests.
 * Cards WITHOUT the field must send NO thinkingConfig (ride the API default —
 * zero behavior change for the shipped cards).
 */
import { describe, it, expect } from 'vitest';
import { GatewayTranslationLayer } from '../GatewayTranslationLayer.js';
import { createGeminiModelConfig } from '../../models/configurators/GoogleConfigurator.js';
import { gemini36Flash } from '../../models/cards/google/gemini-3-6-flash.js';
import { gemini37Flash } from '../../models/cards/google/gemini-3-7-flash.js';
import type { CanonicalMessage } from '@nexus-cortex/types';

const gw = new GatewayTranslationLayer();

const userMsg: CanonicalMessage = {
  uuid: 'msg_thinking_001',
  timestamp: '2026-08-14T00:00:00Z',
  timeline: { sessionId: 's', conversationId: 'c', turnNumber: 1 },
  role: 'user',
  type: 'text',
  content: [{ type: 'text', text: 'hello' }],
  model: { id: 'gemini-3.7-flash', provider: 'google', apiPattern: 'generateContent' },
};

function cardWithLevel(level: 'low' | 'medium' | 'high') {
  return createGeminiModelConfig({
    id: 'gemini-3.7-flash-test',
    displayName: 'Gemini 3.7 Flash (test)',
    family: 'gemini',
    contextWindow: 1000000,
    outputTokens: 65536,
    inputCost: 0.75,
    outputCost: 3.75,
    thinkingLevel: level,
    reasoning: { supported: true, format: 'thinking_block', extractionMethod: 'content_block', pattern: 'upfront' },
  });
}

describe('Gemini thinking_level card plumb', () => {
  it('thinkingLevel option lands in reasoning.defaultEffort on the config', () => {
    expect(cardWithLevel('low').reasoning?.defaultEffort).toBe('low');
    expect(cardWithLevel('high').reasoning?.defaultEffort).toBe('high');
  });

  it('gateway translates defaultEffort → generationConfig.thinkingConfig.thinkingLevel', () => {
    const req = gw.prepareRequest([userMsg], undefined, cardWithLevel('low'));
    const gen = (req.parameters as any).generationConfig;
    expect(gen?.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('shipped gemini-3.6/3.7 cards send NO thinkingConfig (ride the API default)', () => {
    for (const card of [gemini36Flash, gemini37Flash]) {
      const req = gw.prepareRequest([userMsg], undefined, card);
      const gen = (req.parameters as any).generationConfig;
      expect(gen?.thinkingConfig).toBeUndefined();
    }
  });

  it('non-generateContent cards with defaultEffort are untouched (xai/responses path)', () => {
    // A messages-pattern card with defaultEffort (the xai pattern) must not
    // grow a generationConfig — the Responses/Messages paths consume
    // defaultEffort themselves.
    const base = cardWithLevel('high');
    const messagesCard = {
      ...base,
      id: 'fake-messages-model',
      api: { ...base.api, pattern: 'messages' as const },
      tools: { ...base.tools, adapter: 'MessagesAPIAdapter' as const },
    };
    const req = gw.prepareRequest([userMsg], undefined, messagesCard as any);
    expect((req.parameters as any).generationConfig?.thinkingConfig).toBeUndefined();
  });
});
