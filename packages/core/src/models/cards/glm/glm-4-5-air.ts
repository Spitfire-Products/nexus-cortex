/**
 * GLM-4.5 Air (glm-4.5-air)
 * Zhipu AI's lightweight GLM-4.5 Air model
 *
 * Best for: Fast inference, cost-effective tasks, Chinese/English
 * Cost: $0.10 input / $0.30 output per million tokens
 *
 * Features:
 * - 128K context window
 * - Optimized for speed
 * - Function calling
 * - Strong Chinese language support
 * - Cost-effective alternative to GLM-4.5
 */

import { createGLMModelConfig } from '../../configurators/GLMConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const glm45Air: ModelConfig = createGLMModelConfig({
  id: 'glm-4.5-air',
  displayName: 'GLM-4.5 Air',
  family: 'glm-4',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 0.10,
  outputCost: 0.30,
  supportsTools: true,
  supportsVision: false
});
