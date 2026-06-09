/**
 * Claude Opus 4.1 (claude-opus-4-1-20250805)
 * Anthropic's most capable model
 *
 * Release: 2025-08-05
 * Best for: Highly complex tasks requiring maximum capability
 * Cost: $15.00 input / $75.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeOpus41: ModelConfig = createClaudeModelConfig({
  id: 'claude-opus-4-1-20250805',
  displayName: 'Claude Opus 4.1',
  family: 'claude-4.1',
  contextWindow: 200000,
  outputTokens: 8192,
  inputCost: 15.0,
  outputCost: 75.0
});
