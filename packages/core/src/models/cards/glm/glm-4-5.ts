/**
 * GLM-4.5 (glm-4.5)
 * Zhipu AI's GLM-4.5 model
 *
 * Best for: Chinese/English bilingual tasks, general purpose
 * Cost: $0.50 input / $2.00 output per million tokens
 *
 * Features:
 * - 128K context window
 * - Vision support
 * - Function calling
 * - Strong Chinese language support
 */

import { createGLMModelConfig } from '../../configurators/GLMConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const glm45: ModelConfig = createGLMModelConfig({
  id: 'glm-4.5',
  displayName: 'GLM-4.5',
  family: 'glm-4',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 0.50,
  outputCost: 2.00,
  supportsTools: true,
  supportsVision: true
});
