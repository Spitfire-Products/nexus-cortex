/**
 * Grok 4.20 0309 Non-Reasoning (grok-4.20-0309-non-reasoning)
 * xAI extended-context non-reasoning model — 2M context, no thinking traces
 *
 * Best for: Fast long-context tasks where reasoning traces aren't needed
 * Routes through /v1/responses
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok420NonReasoning: ModelConfig = createXAIModelConfig({
  id: 'grok-4.20-0309-non-reasoning',
  displayName: 'Grok 4.20 0309 Non-Reasoning',
  family: 'grok-4',
  contextWindow: 2000000,
  outputTokens: 131072,
  inputCost: 0.20,
  outputCost: 0.50,
  supportsReasoning: false
});
