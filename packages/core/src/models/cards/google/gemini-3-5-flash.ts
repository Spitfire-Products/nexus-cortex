/**
 * Gemini 3.5 Flash (gemini-3.5-flash)
 * Google's latest fast model — GA successor to gemini-3-flash-preview.
 *
 * Verified live 2026-05-27 via web tools e2e benchmark (googleSearch + urlContext).
 * Pricing estimated from gemini-3-flash-preview; update when Google publishes GA rates.
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini35Flash: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.5-flash',
  displayName: 'Gemini 3.5 Flash',
  family: 'gemini',
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.075,
  outputCost: 0.30,
  reasoning: { supported: false }
});
