/**
 * GPT-4.1 (gpt-4.1)
 * OpenAI's GPT-4.1 flagship model
 *
 * Best for: Advanced reasoning tasks
 * Cost: $10.00 input / $30.00 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt41: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-4.1',
  displayName: 'GPT-4.1',
  family: 'gpt-4.1',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 10.0,
  outputCost: 30.0
});
