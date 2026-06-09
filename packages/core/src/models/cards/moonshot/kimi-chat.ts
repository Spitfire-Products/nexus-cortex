/**
 * Kimi Chat (moonshot-v1-8k)
 * Moonshot AI's Kimi model with 8K context
 *
 * Best for: Chinese language tasks, fast responses
 * Cost: $0.84 input / $0.84 output per million tokens (¥12/M tokens)
 *
 * Note: Optimized for Chinese but supports English
 */

import { createMoonshotModelConfig } from '../../configurators/MoonshotConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const kimiChat: ModelConfig = createMoonshotModelConfig({
  id: 'moonshot-v1-8k',
  displayName: 'Kimi Chat (8K)',
  family: 'kimi',
  contextWindow: 8192,
  outputTokens: 4096,
  inputCost: 0.84,   // ¥12 per million tokens ≈ $0.84
  outputCost: 0.84
});
