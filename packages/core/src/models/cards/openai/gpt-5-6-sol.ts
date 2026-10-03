/**
 * GPT-5.6 Sol (gpt-5.6-sol)
 * Frontier tier of the GPT-5.6 family (Sol / Terra / Luna). Listed by GET /v1/models
 * on 2026-10-03 (the bare `gpt-5.6` id is NOT in that list — see gpt-5-6.ts).
 *
 * Sources (2026-10-03):
 *  - developers.openai.com/api/docs/models/gpt-5.6-sol: 1,050,000 context window, 128,000 max
 *    output tokens; reasoning.effort none | low | medium (default) | high | xhigh | max;
 *    Chat Completions + Responses; function calling; knowledge cutoff 2026-02-16.
 *  - developers.openai.com/api/docs/pricing (Standard): short context (≤272K input) $4.00 input /
 *    $0.40 cached / $20.00 output per 1M; long context (>272K) $8.00 / $0.80 / $30.00. The card
 *    carries the short-context rate flat (gpt-5.6 convention).
 *
 * Live 2026-10-03 (one tool call each route):
 *  - /v1/responses (OPENAI_API_MODE=responses): the configurator's top_p default → 400 "Unsupported
 *    parameter: 'top_p' is not supported with this model" → samplingParams:false.
 *  - /v1/chat/completions (default route) + function tools → 400 "Function tools with reasoning_effort are
 *    not supported for gpt-5.6-sol in /v1/chat/completions ... use /v1/responses or set reasoning_effort to
 *    'none'". R19b DROPS reasoning_effort, but the model's default effort is medium, so omission still 400s
 *    (same class as gpt-5.6-luna). Tool use on this card needs OPENAI_API_MODE=responses until the chat
 *    builder sends reasoning_effort:'none' with tools.
 *
 * Reasoning: effort is tunable incl. `none`; the card does not declare `toggleable` (OpenAI card
 * convention — the request effort reaches the wire via CORTEX_OPENAI_TOOLS_REASONING on Responses).
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt56Sol: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.6-sol',
  displayName: 'GPT-5.6 Sol',
  family: 'gpt-5',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 4.00,
  cachedInputCost: 0.40,
  outputCost: 20.00,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  samplingParams: false,
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' }
});
