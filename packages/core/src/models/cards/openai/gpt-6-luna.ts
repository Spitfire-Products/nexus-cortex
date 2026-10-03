/**
 * GPT-6 Luna (gpt-6-luna)
 * Efficient tier of the GPT-6 family (Luna / Sol / 6.1 Sol / Astra) — "our most efficient model for focused, high-volume tasks". Listed by GET /v1/models on 2026-10-03.
 *
 * Sources (2026-10-03):
 *  - developers.openai.com/api/docs/models/gpt-6-luna: 1,050,000 context window, 128,000 max
 *    output tokens; knowledge cutoff 2026-05-18; reasoning.effort none | low | medium (default) | high | xhigh | max;
 *    Chat Completions + Responses; function calling via Responses at every effort (Chat Completions only at effort none);
 *    structured outputs; text + image input.
 *  - developers.openai.com/api/docs/pricing (Standard): $0.10 input / $0.01 cached / $0.125 cache write /
 *    $0.50 output per 1M; long context $0.20 / $0.02 / $0.25 / $0.75 (threshold not stated on the model page;
 *    family convention 272K). The card carries the short-context rate flat (gpt-5.6 convention).
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

export const gpt6Luna: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-6-luna',
  displayName: 'GPT-6 Luna',
  family: 'gpt-6',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 0.10,
  cachedInputCost: 0.01,
  outputCost: 0.50,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  responsesOnly: true,
  samplingParams: false,
  // Narrow-door lift architecture (operator 2026-10-03): the cheap OpenAI action model runs the same frame as the
  // DeepSeek action cards — bash-edit anchor, boot-minimal prompt, lift nudge, headless AskUser drop.
  anchorProfile: 'bash-edit',
  promptPreset: 'boot-minimal',
  liftNudge: true,
  headlessDropAskUser: true,
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' }
});
