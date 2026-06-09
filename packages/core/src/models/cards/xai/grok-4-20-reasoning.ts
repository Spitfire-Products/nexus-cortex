/**
 * Grok 4.20 0309 Reasoning (grok-4.20-0309-reasoning)
 * xAI extended-context reasoning model — 2M context, encrypted reasoning
 *
 * Best for: Deep reasoning over very long contexts, complex analysis
 * Routes through /v1/responses
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok420Reasoning: ModelConfig = createXAIModelConfig({
  id: 'grok-4.20-0309-reasoning',
  displayName: 'Grok 4.20 0309 Reasoning',
  family: 'grok-4',
  contextWindow: 2000000,
  outputTokens: 131072,
  inputCost: 0.25,
  outputCost: 0.60,
  supportsReasoning: true,
  reasoningToggleable: false
});
