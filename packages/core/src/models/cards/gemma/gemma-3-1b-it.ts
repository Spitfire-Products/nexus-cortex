/**
 * Gemma 3 1B IT (gemma-3-1b-it)
 * FREE Google model - 1B parameters
 *
 * Best for: Very fast tasks, 100% free
 * Cost: FREE ($0.00 input / $0.00 output)
 */

import { createGemmaModelConfig } from '../../configurators/GemmaConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemma31bIt: ModelConfig = createGemmaModelConfig({
  id: 'gemma-3-1b-it',
  displayName: 'Gemma 3 1B IT (FREE)',
  family: 'gemma-3',
  contextWindow: 8192,
  outputTokens: 8192
});
