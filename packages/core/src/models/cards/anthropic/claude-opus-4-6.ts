/**
 * Claude Opus 4.6 (claude-opus-4-6)
 * Anthropic's most capable model — frontier reasoning and coding
 *
 * Best for: Highly complex tasks requiring maximum capability and deep reasoning
 * Cost: $15.00 input / $75.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeOpus46: ModelConfig = createClaudeModelConfig({
  id: 'claude-opus-4-6',
  displayName: 'Claude Opus 4.6',
  family: 'claude-4.6',
  contextWindow: 1000000,
  outputTokens: 128000,
  inputCost: 5.0,
  outputCost: 25.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved',
    toggleable: true
  },
  supportsPTC: true
});
