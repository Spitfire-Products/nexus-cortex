/**
 * Gemini 3.1 Pro Preview (gemini-3.1-pro-preview)
 * Google's incremental 3.1 update — improvements over 3-pro-preview.
 *
 * Verified live 2026-05-13 against generativelanguage.googleapis.com.
 * Matches nexus-terminal CORTEX registry.
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini31ProPreview: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.1-pro-preview',
  displayName: 'Gemini 3.1 Pro Preview',
  family: 'gemini',
  contextWindow: 1000000,
  outputTokens: 128000,
  inputCost: 0.15,
  outputCost: 0.40,
  reasoning: { supported: false }
});
