/**
 * Qwen Turbo (qwen-turbo)
 * Alibaba's Qwen Turbo model (通义千问)
 *
 * Best for: Fast responses, cost-effective Chinese language
 * Cost: $0.28 input / $0.28 output per million tokens (¥4/M tokens)
 */

import { createQwenModelConfig } from '../../configurators/QwenConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const qwenTurbo: ModelConfig = createQwenModelConfig({
  id: 'qwen-turbo',
  displayName: 'Qwen Turbo',
  family: 'qwen',
  contextWindow: 8192,
  outputTokens: 2048,
  inputCost: 0.28,   // ¥4 per million tokens
  outputCost: 0.28
});
