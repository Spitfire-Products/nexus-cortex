/**
 * Gemini 3.5 Flash-Lite (gemini-3.5-flash-lite)
 * "Our fastest, most cost-effective 3.5 model for high-throughput execution" (docs/models — Stable).
 *
 * Sources (2026-10-03):
 *  - GET v1beta/models/gemini-3.5-flash-lite (version 3.5-flash-lite-07-2026): inputTokenLimit 1048576,
 *    outputTokenLimit 65536, thinking: true.
 *  - ai.google.dev/gemini-api/docs/thinking: thinking_level minimal | low | medium | high, default
 *    "On (minimal)". thinkingLevel left UNSET (API default minimal; the configurator's thinkingLevel
 *    option has no `minimal` value).
 *  - ai.google.dev/gemini-api/docs/pricing (Standard, paid): $0.30 input (text/image/video/audio) /
 *    $0.03 context caching (+ $1.00 per 1M tokens/hour storage) / $2.50 output incl. thinking per 1M.
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini35FlashLite: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.5-flash-lite',
  displayName: 'Gemini 3.5 Flash-Lite',
  family: 'gemini',
  contextWindow: 1048576,
  outputTokens: 65536,
  inputCost: 0.30,
  cachedInputCost: 0.03,
  outputCost: 2.50,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'upfront'
  }
});
