/**
 * GPT-5 Chat Latest (gpt-5-chat-latest)
 * Latest GPT-5 chat model
 *
 * Best for: Conversations
 * Cost: $2.50 input / $10.00 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt5ChatLatest: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5-chat-latest',
  displayName: 'GPT-5 Chat Latest',
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
