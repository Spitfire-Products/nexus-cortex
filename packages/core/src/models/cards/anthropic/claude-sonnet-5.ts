/**
 * Claude Sonnet 5 (claude-sonnet-5)
 * Anthropic's latest Sonnet — near-Opus quality on coding and agentic work
 *
 * Best for: Agentic coding, long-horizon tool use, complex multi-step reasoning
 * Cost: $3.00 input / $15.00 output per million tokens
 *   (introductory $2.00 / $10.00 per MTok through 2026-08-31)
 *
 * Notes: adaptive thinking on by default; new tokenizer (~30% more tokens than
 * Sonnet 4.6); effort supports low/medium/high/xhigh/max; high-res vision.
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeSonnet5: ModelConfig = createClaudeModelConfig({
  id: 'claude-sonnet-5',
  displayName: 'Claude Sonnet 5',
  family: 'claude-5',
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
