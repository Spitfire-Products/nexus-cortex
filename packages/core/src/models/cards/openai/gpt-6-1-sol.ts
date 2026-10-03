/**
 * GPT-6.1 Sol (gpt-6.1-sol)
 * Newer Sol — "near-Astra performance at a lower cost for complex coding, computer use, and professional work". Listed by GET /v1/models on 2026-10-03.
 *
 * Sources (2026-10-03):
 *  - developers.openai.com/api/docs/models/gpt-6.1-sol: 1,050,000 context window, 128,000 max
 *    output tokens; knowledge cutoff 2026-04-30; reasoning.effort low | medium (default) | high | xhigh | max (no none /
 *    minimal); tool calling via Responses only; text + image input; >272K input → 2x input/cache, 1.5x output.
 *  - developers.openai.com/api/docs/pricing (Standard): $2.00 input / $0.10 cached / $2.50 cache write /
 *    $10.00 output per 1M; long context $4.00 / $0.20 / $5.00 / $15.00.
 *
 * Live 2026-10-03 (/v1/responses unless noted):
 *  - accepts effort low, medium, high, xhigh, max (none + minimal rejected).
 *  - reasoning.effort + top_p → 400 "Unsupported parameter: 'top_p' is not supported with this model" → samplingParams:false.
 *  - /v1/chat/completions + function tools at the default effort → 400 "Function tools with reasoning_effort are not
 *    supported ... use /v1/responses" → responsesOnly (the library routes it to Responses by default).
 * Effort values are translated per model by the gateway (translateReasoningEffort).
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt61Sol: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-6.1-sol',
  displayName: 'GPT-6.1 Sol',
  family: 'gpt-6',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 2.00,
  cachedInputCost: 0.10,
  outputCost: 10.00,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  responsesOnly: true,
  samplingParams: false,
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' }
});
