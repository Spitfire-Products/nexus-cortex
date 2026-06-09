/**
 * GLM-4 (glm-4)
 * Zhipu AI's GLM-4 flagship model
 *
 * Best for: Chinese language, general tasks
 * Cost: $7.00 input / $7.00 output per million tokens (¥100/M tokens)
 *
 * Features: 128K context, vision support
 */

import { createGLMModelConfig } from '../../configurators/GLMConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const glm4: ModelConfig = createGLMModelConfig({
  id: 'glm-4',
  displayName: 'GLM-4',
  family: 'glm-4',
  contextWindow: 131072,  // 128K
  outputTokens: 4096,
  inputCost: 7.0,   // ¥100 per million tokens
  outputCost: 7.0,
  supportsVision: true
});
