/**
 * O3 (o3)
 * OpenAI's O3 reasoning model
 *
 * Best for: Advanced reasoning
 * Cost: $20.00 input / $80.00 output per million tokens
 * Note: Does not support tool calling
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const o3: ModelConfig = createOpenAIModelConfig({
  id: 'o3',
  displayName: 'O3',
  family: 'o3',
  contextWindow: 128000,
  outputTokens: 100000,
  inputCost: 20.0,
  outputCost: 80.0,
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
