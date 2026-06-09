/**
 * Claude 3.5 Sonnet v2 (claude-3-5-sonnet-20241022)
 * Anthropic's Claude 3.5 updated model
 *
 * Release: 2024-10-22
 * Best for: Balanced performance and cost
 * Cost: $3.00 input / $15.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeSonnet35: ModelConfig = createClaudeModelConfig({
  id: 'claude-3-5-sonnet-20241022',
  displayName: 'Claude 3.5 Sonnet v2',
  family: 'claude-3.5',
  contextWindow: 200000,
  outputTokens: 8192,
  inputCost: 3.0,
  outputCost: 15.0
});
