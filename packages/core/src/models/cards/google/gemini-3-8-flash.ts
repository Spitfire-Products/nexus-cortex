/**
 * Gemini 3.8 Flash (gemini-3.8-flash)
 * "Our most intelligent Flash model, engineered for long-horizon software engineering, autonomous
 * agents, and complex enterprise workflows" (ai.google.dev/gemini-api/docs/models — Stable).
 *
 * Sources (2026-10-03):
 *  - GET v1beta/models/gemini-3.8-flash: inputTokenLimit 1048576, outputTokenLimit 65536,
 *    thinking: true, methods generateContent/countTokens/createCachedContent/batchGenerateContent.
 *  - ai.google.dev/gemini-api/docs/thinking: thinking_level low | medium | high, default "On (medium)";
 *    no `minimal` → thinking cannot be turned off. thinkingLevel left UNSET (ride the API default),
 *    matching the 3.6/3.7 cards.
 *  - ai.google.dev/gemini-api/docs/pricing (Standard, paid): $0.75 input / $0.075 context caching /
 *    $3.75 output per 1M THROUGH 2026-12-31 (promo); from 2027-01-01 $1.50 / $0.15 / $7.50.
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini38Flash: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.8-flash',
  displayName: 'Gemini 3.8 Flash',
  family: 'gemini',
  contextWindow: 1048576,
  outputTokens: 65536,
  inputCost: 0.75,
  cachedInputCost: 0.075,
  outputCost: 3.75,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'upfront'
  }
});
