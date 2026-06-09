/**
 * O3 Mini (o3-mini)
 * Faster O3 reasoning model
 *
 * Best for: Efficient reasoning
 * Cost: $5.00 input / $20.00 output per million tokens
 * Note: Does not support tool calling
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const o3Mini: ModelConfig = createOpenAIModelConfig({
  id: 'o3-mini',
  displayName: 'O3 Mini',
  family: 'o3',
  contextWindow: 128000,
  outputTokens: 65536,
  inputCost: 5.0,
  outputCost: 20.0,
  supportsTools: false,
  // R19: o-series rejects `max_tokens` with "400 Unsupported parameter:
  // 'max_tokens' is not supported with this model. Use
  // 'max_completion_tokens' instead." (observed against o3-mini).
  maxTokensParamName: 'max_completion_tokens',
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'upfront'
  }
});
