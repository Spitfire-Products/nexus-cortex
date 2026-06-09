/**
 * Claude 3 Haiku (claude-3-haiku-20240307)
 * Fast and efficient model for quick tasks
 *
 * Release: 2024-03-07
 * Best for: Quick tasks, helper model, cost-effective processing
 * Cost: $0.25 input / $1.25 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeHaiku3: ModelConfig = createClaudeModelConfig({
  id: 'claude-3-haiku-20240307',
  displayName: 'Claude 3 Haiku',
  family: 'claude-3',
  contextWindow: 200000,
  outputTokens: 4096, // API limit confirmed: max 4096 output tokens
  inputCost: 0.25,
  outputCost: 1.25
});
