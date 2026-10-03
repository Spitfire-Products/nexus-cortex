/**
 * GPT-6 Sol (gpt-6-sol)
 * Frontier tier of the GPT-6 family; the model page points to GPT-6.1 Sol as the newer Sol. Listed by GET /v1/models on 2026-10-03.
 *
 * Sources (2026-10-03):
 *  - developers.openai.com/api/docs/models/gpt-6-sol: 1,050,000 context window, 128,000 max
 *    output tokens; knowledge cutoff 2026-04-20; reasoning.effort none | low | medium (default) | high | xhigh | max;
 *    Chat Completions + Responses + Batch; function calling on Chat Completions only at effort none; text + image input;
 *    >272K input → 2x input/cache, 1.5x output.
 *  - developers.openai.com/api/docs/pricing (Standard): $2.00 input / $0.20 cached / $2.50 cache write /
 *    $10.00 output per 1M; long context $4.00 / $0.40 / $5.00 / $15.00.
 *
 * Live 2026-10-03 (/v1/responses unless noted):
 *  - accepts effort none, low, medium, high, xhigh, max (minimal rejected).
 *  - reasoning.effort + top_p → 400 "Unsupported parameter: 'top_p' is not supported with this model" → samplingParams:false.
 *  - /v1/chat/completions + function tools at the default effort → 400 "Function tools with reasoning_effort are not
 *    supported ... use /v1/responses" → responsesOnly (the library routes it to Responses by default).
 * Effort values are translated per model by the gateway (translateReasoningEffort).
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt6Sol: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-6-sol',
  displayName: 'GPT-6 Sol',
  family: 'gpt-6',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 2.00,
  cachedInputCost: 0.20,
  outputCost: 10.00,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  responsesOnly: true,
  samplingParams: false,
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' }
});
