/**
 * Kimi Chat 32K (moonshot-v1-32k)
 * Moonshot AI's Kimi model with 32K context
 *
 * Best for: Long document processing, Chinese language
 * Cost: $1.68 input / $1.68 output per million tokens (¥24/M tokens)
 */

import { createMoonshotModelConfig } from '../../configurators/MoonshotConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const kimiChat32k: ModelConfig = createMoonshotModelConfig({
  id: 'moonshot-v1-32k',
  displayName: 'Kimi Chat (32K)',
  family: 'kimi',
  contextWindow: 32768,
  outputTokens: 4096,
  inputCost: 1.68,   // ¥24 per million tokens
  outputCost: 1.68
});
