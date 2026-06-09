/**
 * O1 Mini (o1-mini)
 * Compact reasoning model
 *
 * Best for: Reasoning tasks, cost-effective
 * Cost: $3.00 input / $12.00 output per million tokens
 * Note: Does not support tools
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const o1Mini: ModelConfig = createOpenAIModelConfig({
  id: 'o1-mini',
  displayName: 'O1 Mini',
  family: 'o1',
  contextWindow: 128000,
  outputTokens: 65536,
  inputCost: 3.0,
  outputCost: 12.0,
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
