/**
 * GPT-4o (gpt-4o)
 * OpenAI's latest flagship model
 *
 * Best for: Complex tasks, excellent performance
 * Cost: $2.50 input / $10.00 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt4o: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-4o',
  displayName: 'GPT-4o',
  family: 'gpt-4o',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 2.5,
  outputCost: 10.0,
  supportsTools: true
});
