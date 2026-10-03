/**
 * Claude Opus 4.8 (claude-opus-4-8)
 * Anthropic's most capable model — state-of-the-art long-horizon agentic execution,
 * knowledge work, and memory. Same request surface as Opus 4.7 (adaptive thinking only).
 *
 * Best for: the hardest, longest-horizon agentic and reasoning tasks
 * Context: 1M tokens (no long-context premium) · Max output: 128K (stream for large outputs)
 * Cost: $5.00 input / $25.00 output per million tokens ($0.50 cached-read)
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeOpus48: ModelConfig = createClaudeModelConfig({
  id: 'claude-opus-4-8',
  displayName: 'Claude Opus 4.8',
  family: 'claude-4.8',
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
  supportsPTC: true,
  // Sampling params (temperature / top_p / top_k) are REMOVED on this model → 400 (claude-api skill thinking/effort table; live
  // 2026-10-03: claude-opus-5 400 "`top_p` is deprecated for this model"). The configurator's top_p 1.0 default broke every request.
  samplingParams: false,
});
