/**
 * Gemini 1.5 Pro (gemini-1.5-pro)
 * Long context model with 2M+ tokens
 *
 * Best for: Very long documents, extensive context
 * Cost: $1.25 input / $5.00 output per million tokens
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini15Pro: ModelConfig = createGeminiModelConfig({
  id: 'gemini-1.5-pro',
  displayName: 'Gemini 1.5 Pro',
  family: 'gemini-1.5',
  contextWindow: 2097152,
  outputTokens: 8192,
  inputCost: 1.25,
  outputCost: 5.0
});
