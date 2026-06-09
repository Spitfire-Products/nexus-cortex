/**
 * Qwen 3 Max Preview (qwen-3-max-preview)
 * Alibaba Cloud's preview of Qwen 3 Max model
 *
 * Best for: Complex reasoning, long context, advanced tasks
 * Cost: $1.20 input / $4.80 output per million tokens (estimated preview pricing)
 *
 * Features:
 * - 128K context window
 * - Advanced reasoning capabilities
 * - Multimodal support
 * - Function calling
 * - Preview/experimental features
 */

import { createQwenModelConfig } from '../../configurators/QwenConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const qwen3MaxPreview: ModelConfig = createQwenModelConfig({
  id: 'qwen-3-max-preview',
  displayName: 'Qwen 3 Max Preview',
  family: 'qwen-3',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 1.20,
  outputCost: 4.80,
  supportsTools: true,
  supportsVision: true
});
