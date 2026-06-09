/**
 * GLM-4 Flash (glm-4-flash)
 * Zhipu AI's fast GLM-4 model
 *
 * Best for: Fast responses, cost-effective
 * Cost: FREE (promotional period)
 *
 * Features: 128K context, optimized for speed
 */

import { createGLMModelConfig } from '../../configurators/GLMConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const glm4Flash: ModelConfig = createGLMModelConfig({
  id: 'glm-4-flash',
  displayName: 'GLM-4 Flash',
  family: 'glm-4',
  contextWindow: 131072,  // 128K
  outputTokens: 4096,
  inputCost: 0.0,   // FREE during promotional period
  outputCost: 0.0
});
