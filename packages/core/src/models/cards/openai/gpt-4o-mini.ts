/**
 * GPT-4o Mini (gpt-4o-mini)
 * Fast and efficient GPT-4o model
 *
 * Best for: Quick tasks, cost-effective
 * Cost: $0.15 input / $0.60 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt4oMini: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-4o-mini',
  displayName: 'GPT-4o Mini',
  family: 'gpt-4o',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 0.15,
  outputCost: 0.60,
  supportsTools: true
});
