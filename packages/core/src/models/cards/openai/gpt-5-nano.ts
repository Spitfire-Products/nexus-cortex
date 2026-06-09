/**
 * GPT-5 Nano (gpt-5-nano)
 * Most cost-effective GPT-5 model
 *
 * Best for: Cost-sensitive tasks
 * Cost: $0.10 input / $0.40 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt5Nano: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5-nano',
  displayName: 'GPT-5 Nano',
  family: 'gpt-5',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 0.10,
  outputCost: 0.40,
  maxTokensParamName: 'max_completion_tokens', // GPT-5 uses max_completion_tokens
  supportsServerSideTools: true, // R20: dynamic /v1/responses switch when hosted tools requested
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
