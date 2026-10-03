/**
 * Gemini 3.1 Flash-Lite (gemini-3.1-flash-lite) — GA successor of the discontinued
 * gemini-3.1-flash-lite-preview card. "Frontier-class performance rivaling larger models at a
 * fraction of the cost" (docs/models — Stable).
 *
 * Sources (2026-10-03):
 *  - GET v1beta/models/gemini-3.1-flash-lite (version 3.1-flash-lite-05-2026): inputTokenLimit 1048576,
 *    outputTokenLimit 65536, thinking: true.
 *  - ai.google.dev/gemini-api/docs/thinking: NOT listed in the thinking_level table — levels/default
 *    UNVERIFIED; thinkingLevel left unset (no thinkingConfig sent).
 *  - ai.google.dev/gemini-api/docs/pricing (Standard, paid): $0.25 input (text/image/video; audio $0.50) /
 *    $0.025 context caching (audio $0.05; + $1.00 per 1M tokens/hour storage) / $1.50 output incl.
 *    thinking per 1M.
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini31FlashLite: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.1-flash-lite',
  displayName: 'Gemini 3.1 Flash-Lite',
  family: 'gemini',
  contextWindow: 1048576,
  outputTokens: 65536,
  inputCost: 0.25,
  cachedInputCost: 0.025,
  outputCost: 1.50,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'upfront'
  }
});
