/**
 * GPT-5.6 (gpt-5.6 — alias for gpt-5.6-sol, the frontier tier)
 * Three-tier family: Sol (this alias) / Terra / Luna. Released 2026-07-09.
 *
 * Pricing (developers.openai.com, verified 2026-08-13): $5 in / $30 out per
 * 1M; CACHED input $0.50 (10%); cache WRITES billed 1.25x standard input.
 * 🔴 LONG-CONTEXT SURCHARGE: input > 272K tokens → 2x input + 1.5x output
 * for the ENTIRE request — keep sessions under 272K or compact.
 * Prompt caching automatic (stable prefix); cached reads land in
 * usage.prompt_tokens_details.cached_tokens (gateway extracts).
 * Reasoning: reasoning_effort none|low|medium(default)|high|xhigh|max.
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt56: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.6',
  displayName: 'GPT-5.6',
  family: 'gpt-5',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 5.0,
  outputCost: 30.0,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
