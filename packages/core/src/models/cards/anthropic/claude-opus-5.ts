/**
 * Claude Opus 5 (claude-opus-5)
 * Successor to Opus 4.8 in the Opus line — strongest on long-horizon agentic
 * work and coding. Drop-in at Opus 4.8 pricing with the same feature set.
 * Thinking is ON by default (omitting the param runs adaptive); disabling
 * thinking is only allowed at effort high or below. Safety classifiers can
 * return stop_reason "refusal" — check before reading content.
 *
 * Best for: complex agentic coding, multi-file features, larger refactors
 * Context: 1M tokens (default and max) · Max output: 128K (stream for large outputs)
 * Cost: $5.00 input / $25.00 output per million tokens · 512-token prompt-cache minimum
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeOpus5: ModelConfig = createClaudeModelConfig({
  id: 'claude-opus-5',
  displayName: 'Claude Opus 5',
  family: 'claude-5',
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
