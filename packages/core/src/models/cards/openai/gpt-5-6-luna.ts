/**
 * GPT-5.6 Luna (gpt-5.6-luna)
 * Mid/economy tier of the GPT-5.6 family (Sol/Terra/Luna; released 2026-07-09).
 * Pricing effective 2026-07-30 cuts: $0.20 in / $1.20 out per 1M (cached input
 * ~10% of input per OpenAI convention). Same 1.05M ctx / 128K out and
 * reasoning_effort levels as Sol; same 272K long-context surcharge.
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt56Luna: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.6-luna',
  displayName: 'GPT-5.6 Luna',
  family: 'gpt-5',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 0.20,
  outputCost: 1.20,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  // Live 2026-10-03: /v1/responses + reasoning.effort + top_p → 400 "Unsupported parameter: 'top_p'".
  samplingParams: false,
  // Function tools 400 on chat/completions unless effort is none (live 2026-10-03) → Responses by default.
  responsesOnly: true,
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' }
});
