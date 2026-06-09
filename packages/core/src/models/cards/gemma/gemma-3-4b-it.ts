/**
 * Gemma 3 4B IT (gemma-3-4b-it)
 * FREE Google model - 4B parameters
 *
 * Best for: Quick tasks, 100% free
 * Cost: FREE ($0.00 input / $0.00 output)
 */

import { createGemmaModelConfig } from '../../configurators/GemmaConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemma34bIt: ModelConfig = createGemmaModelConfig({
  id: 'gemma-3-4b-it',
  displayName: 'Gemma 3 4B IT (FREE)',
  family: 'gemma-3',
  contextWindow: 8192,
  outputTokens: 8192
});
