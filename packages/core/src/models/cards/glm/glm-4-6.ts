/**
 * GLM-4.6 (glm-4.6)
 * Zhipu AI's GLM-4.6 model with enhanced capabilities
 *
 * Best for: Chinese/English bilingual tasks, reasoning, long context
 * Cost: $0.50 input / $2.00 output per million tokens
 *
 * Features:
 * - 128K context window
 * - Enhanced reasoning capabilities
 * - Vision support
 * - Function calling
 * - Strong Chinese language support
 */

import { createGLMModelConfig } from '../../configurators/GLMConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const glm46: ModelConfig = createGLMModelConfig({
  id: 'glm-4.6',
  displayName: 'GLM-4.6',
  family: 'glm-4',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 0.50,
  outputCost: 2.00,
  supportsTools: true,
  supportsVision: true
});
