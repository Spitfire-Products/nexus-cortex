/**
 * O1 Pro (o1-pro)
 * OpenAI's O1 Pro reasoning model
 *
 * Best for: Complex reasoning tasks
 * Cost: $30.00 input / $120.00 output per million tokens
 * Note: Does not support tool calling
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const o1Pro: ModelConfig = createOpenAIModelConfig({
  id: 'o1-pro',
  displayName: 'O1 Pro',
  family: 'o1',
  contextWindow: 128000,
  outputTokens: 100000,
  inputCost: 30.0,
  outputCost: 120.0,
  // R19: o-series requires max_completion_tokens (not max_tokens)

  maxTokensParamName: 'max_completion_tokens',

  supportsTools: false,
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'upfront'
  }
});
