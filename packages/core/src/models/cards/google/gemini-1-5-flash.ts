/**
 * Gemini 1.5 Flash (gemini-1.5-flash)
 * Fast Gemini 1.5 model
 *
 * Best for: Quick tasks
 * Cost: $0.15 input / $0.60 output per million tokens
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini15Flash: ModelConfig = createGeminiModelConfig({
  id: 'gemini-1.5-flash',
  displayName: 'Gemini 1.5 Flash',
  family: 'gemini-1.5',
  contextWindow: 1048576,
  outputTokens: 8192,
  inputCost: 0.15,
  outputCost: 0.60
});
