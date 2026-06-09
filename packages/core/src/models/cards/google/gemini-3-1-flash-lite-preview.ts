/**
 * DISCONTINUED — 404 as of 2026-05-27. Removed from registry.
 * Successor: gemini-3.5-flash (GA).
 *
 * Gemini 3.1 Flash Lite Preview (gemini-3.1-flash-lite-preview)
 * Was: Google's smallest/fastest Gemini 3.1 — ultra-low-latency tier.
 * Originally verified live 2026-05-13.
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini31FlashLitePreview: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.1-flash-lite-preview',
  displayName: 'Gemini 3.1 Flash Lite Preview',
  family: 'gemini',
  contextWindow: 1000000,
  outputTokens: 64000,
  inputCost: 0.04,
  outputCost: 0.16,
  reasoning: { supported: false }
});
