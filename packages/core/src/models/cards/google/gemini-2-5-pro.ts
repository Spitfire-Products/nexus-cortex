/**
 * Gemini 2.5 Pro (gemini-2.5-pro)
 * Google's most capable Gemini model
 *
 * Best for: Complex tasks, long context
 * Cost: $2.50 input / $10.00 output per million tokens
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini25Pro: ModelConfig = createGeminiModelConfig({
  id: 'gemini-2.5-pro',
  displayName: 'Gemini 2.5 Pro',
  family: 'gemini-2.5',
  contextWindow: 2097152,
  outputTokens: 8192,
  inputCost: 2.50,
  outputCost: 10.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved'
  }
});
