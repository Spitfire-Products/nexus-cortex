/**
 * Claude 4 Sonnet (claude-sonnet-4-20250514)
 * Anthropic's Claude 4 flagship model
 *
 * Release: 2025-05-14
 * Best for: Complex reasoning, long conversations
 * Cost: $3.00 input / $15.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeSonnet4: ModelConfig = createClaudeModelConfig({
  id: 'claude-sonnet-4-20250514',
  displayName: 'Claude 4 Sonnet',
  family: 'claude-4',
  contextWindow: 200000,
  outputTokens: 8192,
  inputCost: 3.0,
  outputCost: 15.0
});
