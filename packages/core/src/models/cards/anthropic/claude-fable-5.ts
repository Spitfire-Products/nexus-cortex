/**
 * Claude Fable 5 (claude-fable-5)
 * Anthropic's most powerful model — a new tier above Opus. Same adaptive-thinking-only
 * request surface as Opus 4.7/4.8, with one stricter rule: an explicit
 * thinking {type:'disabled'} returns a 400 — omit the thinking param instead
 * (the harness already omits it on continuation requests).
 *
 * Best for: the hardest reasoning and longest-horizon agentic tasks
 * Context: 1M tokens · Max output: 128K (stream for large outputs)
 * Cost: $10.00 input / $50.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeFable5: ModelConfig = createClaudeModelConfig({
  id: 'claude-fable-5',
  displayName: 'Claude Fable 5',
  family: 'claude-fable-5',
  contextWindow: 1000000,
  outputTokens: 128000,
  inputCost: 10.0,
  outputCost: 50.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved',
    toggleable: true
  },
  supportsPTC: true
});
