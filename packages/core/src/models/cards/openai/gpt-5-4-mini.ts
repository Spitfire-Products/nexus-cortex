/**
 * GPT-5.4 Mini (gpt-5.4-mini)
 * OpenAI's cost-efficient GPT-5.4 variant with Responses API
 *
 * Best for: Balanced cost/performance, agentic tasks at scale
 * Cost: $0.40 input / $1.60 output per million tokens
 * Routes through /v1/responses. Server tools: web_search, code_interpreter.
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt54Mini: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.4-mini',
  displayName: 'GPT-5.4 Mini',
  family: 'gpt-5',
  contextWindow: 400000,
  outputTokens: 128000,
  inputCost: 0.40,
  outputCost: 1.60,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true, // R20: dynamic /v1/responses switch when hosted tools requested
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
