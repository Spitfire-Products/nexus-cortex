/**
 * Gemini 3 Flash Preview (gemini-3-flash-preview)
 * Google's fast Gemini 3 variant — lower cost, lower latency.
 *
 * Best for: High-throughput tool calling, quick reasoning, agent loops.
 * Verified live 2026-05-13 against generativelanguage.googleapis.com.
 * Matches nexus-terminal CORTEX registry.
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini3FlashPreview: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3-flash-preview',
  displayName: 'Gemini 3 Flash Preview',
  family: 'gemini',
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.075,
  outputCost: 0.30,
  reasoning: { supported: false }
});
