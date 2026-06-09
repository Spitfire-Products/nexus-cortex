/**
 * Claude Opus 4.5 (claude-opus-4-5-20251101)
 * Anthropic's most capable model with extended thinking
 *
 * Release: 2025-11-01
 * Best for: Highly complex tasks requiring maximum capability and deep reasoning
 * Cost: $15.00 input / $75.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeOpus45: ModelConfig = createClaudeModelConfig({
  id: 'claude-opus-4-5-20251101',
  displayName: 'Claude Opus 4.5',
  family: 'claude-4.5',
  contextWindow: 200000,
  outputTokens: 8192,
  inputCost: 15.0,
  outputCost: 75.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved',
    toggleable: true  // Extended reasoning can be toggled; native interleaved thinking always visible
  },
  supportsPTC: true
});
