/**
 * Grok 4.7 — chat/completions variant (grok-4.7-chat)
 *
 * Same backend model as `grok-4.7`, pinned to the third xAI transport (OpenAI-shape
 * https://api.x.ai/v1/chat/completions), mirroring grok-4.3-chat. reasoning_effort IS accepted:
 * GET /v1/language-models/grok-4.7 capabilities.reasoning_effort = [low, medium, high, xhigh],
 * default high (2026-10-03) — so the card declares reasoningEffort 'high' (the capability signal
 * xaiChatReasoningEffort gates on). Client tools only on this route. Specs/pricing: see grok-4-7.ts.
 * DARK/additive: selected only by model id (`-m grok-4.7-chat`).
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok47Chat: ModelConfig = createXAIModelConfig({
  id: 'grok-4.7-chat',
  modelId: 'grok-4.7',
  displayName: 'Grok 4.7 (Chat Completions)',
  family: 'grok-4',
  contextWindow: 500000,
  outputTokens: 131072,
  inputCost: 2.00,
  cachedInputCost: 0.50,
  outputCost: 6.00,
  supportsReasoning: true,
  reasoningToggleable: false,
  reasoningEffort: 'high',
  apiMode: 'chat',
});
