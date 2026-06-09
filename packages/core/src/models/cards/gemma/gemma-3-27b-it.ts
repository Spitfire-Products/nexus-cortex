/**
 * Gemma 3 27B IT (gemma-3-27b-it)
 * FREE Google model - 27B parameters
 *
 * Best for: Large-scale tasks, 100% free
 * Cost: FREE ($0.00 input / $0.00 output)
 */

import { createGemmaModelConfig } from '../../configurators/GemmaConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemma327bIt: ModelConfig = createGemmaModelConfig({
  id: 'gemma-3-27b-it',
  displayName: 'Gemma 3 27B IT (FREE)',
  family: 'gemma-3',
  contextWindow: 8192,
  outputTokens: 8192
});
