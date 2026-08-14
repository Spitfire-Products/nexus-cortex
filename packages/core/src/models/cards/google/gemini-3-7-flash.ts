/**
 * Gemini 3.7 Flash (gemini-3.7-flash)
 * Released 2026-08-13 — large gains in coding, agent execution, document
 * work and computer use over 3.6 Flash at the SAME intro price; tunable
 * thinking (thinking_level low|medium|high, API default medium). The plumb
 * exists: set `thinkingLevel` on this card (createGeminiModelConfig option →
 * reasoning.defaultEffort → the gateway sends
 * generationConfig.thinkingConfig.thinkingLevel). Left UNSET here so we keep
 * riding the API default.
 *
 * Pricing = INTRO rate through 2026-12-31 ($0.75/$3.75), standard from
 * 2027-01-01 = $1.50/$7.50 (ai.google.dev/gemini-api/docs/latest-model,
 * verified 2026-08-13 release day). Implicit context caching applies; cached
 * reads land in usageMetadata.cachedContentTokenCount (gateway extracts).
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini37Flash: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.7-flash',
  displayName: 'Gemini 3.7 Flash',
  family: 'gemini',
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.75,
  outputCost: 3.75,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'upfront'
  }
});
