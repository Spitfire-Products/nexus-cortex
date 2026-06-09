/**
 * Claude 3.5 Haiku (claude-3-5-haiku-20241022)
 * Fast and efficient Claude 3.5 model
 *
 * Release: 2024-10-22
 * Best for: Quick tasks with good capability/cost balance
 * Cost: $0.80 input / $4.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeHaiku35: ModelConfig = createClaudeModelConfig({
  id: 'claude-3-5-haiku-20241022',
  displayName: 'Claude 3.5 Haiku',
  family: 'claude-3.5',
  contextWindow: 200000,
  outputTokens: 8192,
  inputCost: 0.80,
  outputCost: 4.0
});
