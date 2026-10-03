/**
 * GPT-6 Astra (gpt-6-astra)
 * Top tier of the GPT-6 family. Listed by GET /v1/models on 2026-10-03.
 *
 * Sources (2026-10-03):
 *  - developers.openai.com/api/docs/models/gpt-6-astra: 1,050,000 context window, 128,000 max
 *    output tokens; knowledge cutoff 2026-04-30; reasoning.effort low | medium | high | xhigh | max; Chat Completions +
 *    Responses; function calling; text + image input; >272K input → 2x input, 1.5x output.
 *  - developers.openai.com/api/docs/pricing (Standard): $10.00 input / $1.00 cached / $12.50 cache write /
 *    $50.00 output per 1M; long context $20.00 / $2.00 / $25.00 / $75.00.
 *
 * Live 2026-10-03 (/v1/responses unless noted):
 *  - effort low ok (only level probed — premium budget gate).
 *  - reasoning.effort + top_p → 400 "Unsupported parameter: 'top_p' is not supported with this model" → samplingParams:false.
 *  - /v1/chat/completions + function tools at the default effort → 400 "Function tools with reasoning_effort are not
 *    supported ... use /v1/responses" → responsesOnly (the library routes it to Responses by default).
 * Effort values are translated per model by the gateway (translateReasoningEffort).
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt6Astra: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-6-astra',
  displayName: 'GPT-6 Astra',
  family: 'gpt-6',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 10.00,
  cachedInputCost: 1.00,
  outputCost: 50.00,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  responsesOnly: true,
  samplingParams: false,
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' }
});
