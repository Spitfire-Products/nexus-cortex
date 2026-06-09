/**
 * O1 (o1)
 * OpenAI's reasoning model
 *
 * Best for: Complex reasoning tasks
 * Cost: $15.00 input / $60.00 output per million tokens
 * Note: Does not support tools
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const o1: ModelConfig = createOpenAIModelConfig({
  id: 'o1',
  displayName: 'O1',
  family: 'o1',
  contextWindow: 128000,
  outputTokens: 100000,
  inputCost: 15.0,
  outputCost: 60.0,
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
