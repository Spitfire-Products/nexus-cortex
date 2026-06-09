/**
 * GPT-4.1 Mini (gpt-4.1-mini)
 * Faster GPT-4.1 model
 *
 * Best for: Balanced performance
 * Cost: $1.00 input / $3.00 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt41Mini: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-4.1-mini',
  displayName: 'GPT-4.1 Mini',
  family: 'gpt-4.1',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 1.0,
  outputCost: 3.0
});
