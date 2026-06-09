/**
 * O4 Mini (o4-mini)
 * OpenAI's O4 Mini reasoning model
 *
 * Best for: Fast reasoning tasks
 * Cost: $6.00 input / $24.00 output per million tokens
 * Note: Does not support tool calling
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const o4Mini: ModelConfig = createOpenAIModelConfig({
  id: 'o4-mini',
  displayName: 'O4 Mini',
  family: 'o4',
  contextWindow: 128000,
  outputTokens: 65536,
  inputCost: 6.0,
  outputCost: 24.0,
  supportsTools: true,
  maxTokensParamName: 'max_completion_tokens',
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'upfront'
  }
});
