/**
 * Claude Sonnet 4.6 (claude-sonnet-4-6)
 * Anthropic's balanced flagship — strong coding and reasoning at lower cost
 *
 * Best for: Complex coding tasks, long-context analysis, multi-step reasoning
 * Cost: $3.00 input / $15.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeSonnet46: ModelConfig = createClaudeModelConfig({
  id: 'claude-sonnet-4-6',
  displayName: 'Claude Sonnet 4.6',
  family: 'claude-4.6',
  contextWindow: 1000000,
  outputTokens: 64000,
  inputCost: 3.0,
  outputCost: 15.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved',
    toggleable: true
  },
  supportsPTC: true
});
