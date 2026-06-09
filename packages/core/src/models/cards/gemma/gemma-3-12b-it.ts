/**
 * Gemma 3 12B IT (gemma-3-12b-it)
 * FREE Google model - 12B parameters
 *
 * Best for: Medium tasks, 100% free
 * Cost: FREE ($0.00 input / $0.00 output)
 */

import { createGemmaModelConfig } from '../../configurators/GemmaConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemma312bIt: ModelConfig = createGemmaModelConfig({
  id: 'gemma-3-12b-it',
  displayName: 'Gemma 3 12B IT (FREE)',
  family: 'gemma-3',
  contextWindow: 8192,
  outputTokens: 8192
});
