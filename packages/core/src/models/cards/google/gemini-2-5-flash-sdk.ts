/**
 * Gemini 2.5 Flash SDK (gemini-2.5-flash-sdk)
 * EXPERIMENTAL: SDK-based version for testing
 *
 * Uses @google/generative-ai SDK instead of REST API
 * Best for: Testing improved stability and performance
 * Cost: $0.15 input / $0.60 output per million tokens
 */

import { createGeminiSDKModelConfig } from '../../configurators/GoogleSDKConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini25FlashSDK: ModelConfig = createGeminiSDKModelConfig({
  id: 'gemini-2.5-flash-sdk',
  displayName: 'Gemini 2.5 Flash SDK',
  family: 'gemini-2.5',
  contextWindow: 1048576,
  outputTokens: 65536,
  inputCost: 0.15,
  outputCost: 0.60,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved'
  }
});
