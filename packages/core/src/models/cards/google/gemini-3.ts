/**
 * DISCONTINUED — 404 as of 2026-05-27. Removed from registry.
 * Successor: gemini-3.5-flash (GA) or gemini-3.1-pro-preview.
 *
 * Gemini 3 Pro Preview (gemini-3-pro-preview)
 * Was: Google's multimodal model with advanced safety and tool orchestration.
 * Originally verified live 2026-05-13.
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini3: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3-pro-preview',
  displayName: 'Gemini 3 Pro Preview',
  family: 'gemini',
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.15,
  outputCost: 0.40,
  reasoning: { supported: false }  // Internal only; no exposed traces
});