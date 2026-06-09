/**
 * Claude 4.5 Haiku (claude-haiku-4-5)
 * Anthropic's fast and efficient Claude 4.5 model
 *
 * Release: 2025-10-01
 * Best for: Quick tasks with excellent capability/cost balance
 * Cost: $1.00 input / $5.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeHaiku45: ModelConfig = createClaudeModelConfig({
  id: 'claude-haiku-4-5',  // Using the alias that auto-updates
  displayName: 'Claude Haiku 4.5',
  family: 'claude-4.5',
  contextWindow: 200000,
  outputTokens: 64000,
  inputCost: 1.0,
  outputCost: 5.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved',
    toggleable: true  // Extended reasoning can be toggled; native interleaved thinking always visible
  }
});
