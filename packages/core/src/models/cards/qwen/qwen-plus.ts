/**
 * Qwen Plus (qwen-plus)
 * Alibaba's Qwen Plus model
 *
 * Best for: Balanced performance and cost
 * Cost: $0.56 input / $0.56 output per million tokens (¥8/M tokens)
 */

import { createQwenModelConfig } from '../../configurators/QwenConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const qwenPlus: ModelConfig = createQwenModelConfig({
  id: 'qwen-plus',
  displayName: 'Qwen Plus',
  family: 'qwen',
  contextWindow: 32768,
  outputTokens: 4096,
  inputCost: 0.56,   // ¥8 per million tokens
  outputCost: 0.56
});
