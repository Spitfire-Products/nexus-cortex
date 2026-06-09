/**
 * GPT-5.4 (gpt-5.4)
 * OpenAI's latest GPT-5 series with Responses API and server tools
 *
 * Best for: Complex reasoning, coding, agentic tasks
 * Cost: $2.50 input / $10.00 output per million tokens
 * Routes through /v1/responses. Server tools: web_search, code_interpreter.
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt54: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.4',
  displayName: 'GPT-5.4',
  family: 'gpt-5',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 2.50,
  outputCost: 10.0,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true, // R20: dynamic /v1/responses switch when hosted tools requested
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
