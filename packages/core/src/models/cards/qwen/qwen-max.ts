/**
 * Qwen Max (qwen-max)
 * Alibaba's flagship Qwen model
 *
 * Best for: Complex tasks, highest quality
 * Cost: $2.80 input / $2.80 output per million tokens (¥40/M tokens)
 */

import { createQwenModelConfig } from '../../configurators/QwenConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const qwenMax: ModelConfig = createQwenModelConfig({
  id: 'qwen-max',
  displayName: 'Qwen Max',
  family: 'qwen',
  contextWindow: 8192,
  outputTokens: 4096,
  inputCost: 2.80,   // ¥40 per million tokens
  outputCost: 2.80
});
