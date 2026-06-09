/**
 * Kimi Chat 128K (moonshot-v1-128k)
 * Moonshot AI's Kimi model with 128K context
 *
 * Best for: Very long documents, comprehensive analysis
 * Cost: $4.20 input / $4.20 output per million tokens (¥60/M tokens)
 */

import { createMoonshotModelConfig } from '../../configurators/MoonshotConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const kimiChat128k: ModelConfig = createMoonshotModelConfig({
  id: 'moonshot-v1-128k',
  displayName: 'Kimi Chat (128K)',
  family: 'kimi',
  contextWindow: 131072,  // 128K
  outputTokens: 4096,
  inputCost: 4.20,   // ¥60 per million tokens
  outputCost: 4.20
});
