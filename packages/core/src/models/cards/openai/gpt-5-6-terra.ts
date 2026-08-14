/**
 * GPT-5.6 Terra (gpt-5.6-terra)
 * Mid/economy tier of the GPT-5.6 family (Sol/Terra/Luna; released 2026-07-09).
 * Pricing effective 2026-07-30 cuts: $2.0 in / $12.0 out per 1M (cached input
 * ~10% of input per OpenAI convention). Same 1.05M ctx / 128K out and
 * reasoning_effort levels as Sol; same 272K long-context surcharge.
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt56Terra: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.6-terra',
  displayName: 'GPT-5.6 Terra',
  family: 'gpt-5',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 2.0,
  outputCost: 12.0,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' }
});
