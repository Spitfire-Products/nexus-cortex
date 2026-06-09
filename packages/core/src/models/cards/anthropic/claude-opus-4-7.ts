/**
 * Claude Opus 4.7 (claude-opus-4-7)
 * Anthropic's latest and most capable model — frontier reasoning, coding, and agentic tasks
 *
 * Best for: Highly complex tasks requiring maximum capability and deep reasoning
 * Cost: $15.00 input / $75.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeOpus47: ModelConfig = createClaudeModelConfig({
  id: 'claude-opus-4-7',
  displayName: 'Claude Opus 4.7',
  family: 'claude-4.7',
  contextWindow: 1000000,
  outputTokens: 128000,
  inputCost: 15.0,
  outputCost: 75.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved',
    toggleable: true
  },
  supportsPTC: true
});
