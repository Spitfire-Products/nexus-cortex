/**
 * Claude 4.5 Sonnet (claude-sonnet-4-5-20250929)
 * Anthropic's latest flagship model - best coding performance
 *
 * Release: 2025-09-29
 * Best for: Complex coding tasks, long-context analysis, multi-step reasoning
 * Cost: $3.00 input / $15.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeSonnet45: ModelConfig = createClaudeModelConfig({
  id: 'claude-sonnet-4-5-20250929',
  displayName: 'Claude 4.5 Sonnet',
  family: 'claude-4.5',
  contextWindow: 200000,
  outputTokens: 64000,
  inputCost: 3.0,
  outputCost: 15.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved',
    toggleable: true  // Extended reasoning can be toggled; native interleaved thinking always visible
  },
  supportsPTC: true
});
