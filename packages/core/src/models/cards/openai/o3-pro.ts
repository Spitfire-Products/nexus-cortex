/**
 * O3 Pro (o3-pro)
 * OpenAI's O3 Pro reasoning model
 *
 * Best for: Premium reasoning tasks
 * Cost: $40.00 input / $160.00 output per million tokens
 * Note: Does not support tool calling
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const o3Pro: ModelConfig = createOpenAIModelConfig({
  id: 'o3-pro',
  displayName: 'O3 Pro',
  family: 'o3',
  contextWindow: 128000,
  outputTokens: 100000,
  inputCost: 40.0,
  outputCost: 160.0,
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
