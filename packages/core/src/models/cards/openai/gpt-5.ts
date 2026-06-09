/**
 * GPT-5 (gpt-5)
 * OpenAI's GPT-5 flagship model
 *
 * Best for: Advanced tasks
 * Cost: $2.50 input / $10.00 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt5: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5',
  displayName: 'GPT-5',
  family: 'gpt-5',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 2.5,
  outputCost: 10.0,
  maxTokensParamName: 'max_completion_tokens', // GPT-5 uses max_completion_tokens
  supportsServerSideTools: true, // R20: dynamic /v1/responses switch when hosted tools requested
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
