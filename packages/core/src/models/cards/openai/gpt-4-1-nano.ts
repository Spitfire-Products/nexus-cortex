/**
 * GPT-4.1 Nano (gpt-4.1-nano)
 * Most cost-effective GPT-4.1 model
 *
 * Best for: Cost-sensitive tasks
 * Cost: $0.50 input / $1.50 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt41Nano: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-4.1-nano',
  displayName: 'GPT-4.1 Nano',
  family: 'gpt-4.1',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 0.50,
  outputCost: 1.50
});
