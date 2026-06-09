/**
 * MiniMax M2 Stable (MiniMax-M2-Stable)
 * MiniMax's stable M2 model with 1M token context
 *
 * Best for: Production deployments, Chinese language, long context
 * Cost: $0.42 input / $1.40 output per million tokens (¥3/¥10 per M tokens)
 *
 * Features:
 * - 1M token context window (1,024,000 tokens)
 * - Anthropic-compatible Messages API
 * - Strong Chinese language support
 * - Vision capabilities
 * - Function calling support
 * - Stable version optimized for production use
 *
 * API Pattern: Uses Anthropic-compatible Messages API
 * Note: Same API pattern as Claude, making integration easy
 */

import { createMiniMaxModelConfig } from '../../configurators/MiniMaxConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const minimaxM2Stable: ModelConfig = createMiniMaxModelConfig({
  id: 'MiniMax-M2-Stable',
  displayName: 'MiniMax M2 Stable',
  family: 'minimax-m2',
  contextWindow: 1024000,  // 1M tokens
  outputTokens: 8192,
  inputCost: 0.42,   // ¥3 per million tokens ≈ $0.42
  outputCost: 1.40,  // ¥10 per million tokens ≈ $1.40
  supportsTools: true,
  supportsVision: true
});
