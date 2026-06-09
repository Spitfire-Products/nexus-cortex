/**
 * Gemini 2.0 Flash Lite (gemini-2.0-flash-lite)
 * Most cost-effective Gemini 2.0 model
 *
 * Best for: Cost-sensitive tasks
 * Cost: $0.075 input / $0.30 output per million tokens
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini20FlashLite: ModelConfig = createGeminiModelConfig({
  id: 'gemini-2.0-flash-lite',
  displayName: 'Gemini 2.0 Flash Lite',
  family: 'gemini-2.0',
  contextWindow: 1048576,
  outputTokens: 8192,
  inputCost: 0.075,
  outputCost: 0.30
});
