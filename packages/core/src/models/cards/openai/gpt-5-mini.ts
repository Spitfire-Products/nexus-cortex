/**
 * GPT-5 Mini (gpt-5-mini)
 * Fast GPT-5 model
 *
 * Best for: Quick tasks
 * Cost: $0.15 input / $0.60 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt5Mini: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5-mini',
  displayName: 'GPT-5 Mini',
  family: 'gpt-5',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 0.15,
  outputCost: 0.60,
  maxTokensParamName: 'max_completion_tokens', // GPT-5 uses max_completion_tokens
  supportsServerSideTools: true, // R20: dynamic /v1/responses switch when hosted tools requested
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
