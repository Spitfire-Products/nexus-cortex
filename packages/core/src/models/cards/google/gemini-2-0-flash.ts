/**
 * Gemini 2.0 Flash (gemini-2.0-flash)
 * Google's latest fast model
 *
 * Best for: Fast tasks with good capability
 * Cost: $0.10 input / $0.40 output per million tokens
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini20Flash: ModelConfig = createGeminiModelConfig({
  id: 'gemini-2.0-flash',
  displayName: 'Gemini 2.0 Flash',
  family: 'gemini-2.0',
  contextWindow: 1048576,
  outputTokens: 8192,
  inputCost: 0.10,
  outputCost: 0.40,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved'
  }
});
