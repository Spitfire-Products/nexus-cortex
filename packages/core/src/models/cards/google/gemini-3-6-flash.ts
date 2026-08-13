/**
 * Gemini 3.6 Flash (gemini-3.6-flash)
 * Google's agentic-efficiency flash — cuts long-horizon agent token cost
 * substantially vs 3.5; tunable thinking (thinking_level low|medium|high,
 * API default medium — we ride the default; explicit plumb is a follow-up).
 *
 * Pricing = INTRO rate through 2026-12-31 ($0.75/$3.75), standard from
 * 2027-01-01 = $1.50/$7.50 (ai.google.dev/gemini-api/docs/latest-model,
 * verified 2026-08-13). Implicit context caching applies; cached reads land
 * in usageMetadata.cachedContentTokenCount (gateway extracts).
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini36Flash: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.6-flash',
  displayName: 'Gemini 3.6 Flash',
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
