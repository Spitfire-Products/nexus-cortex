/**
 * GPT-5 Codex (gpt-5-codex)
 * Specialized coding model with server-side tools
 *
 * Best for: Code generation with tool execution
 * Cost: $2.50 input / $10.00 output per million tokens
 * Note: Uses Responses API pattern
 */

import { createOpenAIResponsesModelConfig } from '../../configurators/OpenAIResponsesConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt5Codex: ModelConfig = createOpenAIResponsesModelConfig({
  id: 'gpt-5-codex',
  displayName: 'GPT-5 Codex',
  family: 'gpt-5',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 2.5,
  outputCost: 10.0
});
