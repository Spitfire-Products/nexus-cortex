/**
 * GPT-5.5 (gpt-5.5)
 * OpenAI's frontier model — most capable in the GPT-5 series
 *
 * Best for: Frontier-level reasoning, complex multi-step tasks
 * Cost: $5.00 input / $20.00 output per million tokens
 * Routes through /v1/responses. Server tools: web_search, code_interpreter.
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt55: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.5',
  displayName: 'GPT-5.5',
  family: 'gpt-5',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 5.0,
  outputCost: 20.0,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true, // R20: dynamic /v1/responses switch when hosted tools requested
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
