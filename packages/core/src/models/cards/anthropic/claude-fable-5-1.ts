/**
 * Claude Fable 5.1 (claude-fable-5-1)
 * Anthropic's most capable widely released model; successor to Fable 5 at the same per-token price.
 *
 * Sources (2026-10-03):
 *  - GET /v1/models/claude-fable-5-1: max_input_tokens 1000000, max_tokens 128000;
 *    capabilities.thinking.types {enabled:false, adaptive:true}; effort low|medium|high|xhigh|max.
 *  - claude-api skill (model table, thinking/effort table, shared/model-migration.md
 *    "Migrating to Claude Fable 5.1 from Claude Fable 5"):
 *    · Thinking is always on: omit `thinking` or send {type:'adaptive'}; {type:'disabled'} and
 *      budget_tokens → 400. Depth via output_config.effort (low..max).
 *    · Forced tool_choice `any`/`tool` → 400 (new vs Fable 5) → forcedToolChoice:false.
 *    · Preserved thinking: blocks bound to the producing model; replay unchanged on the same model;
 *      editing earlier turns invalidates them. Raw CoT never returned (display omitted by default).
 *    · Sampling params removed → 400 → samplingParams:false (the configurator's top_p default
 *      1.0 400'd live 2026-10-03: "`top_p` is deprecated for this model").
 *    · 30-day retention required (ZDR orgs get 400).
 *    · Safety classifiers can return stop_reason "refusal".
 *  - Pricing (vendor page, verified 2026-10-03): $10.00 input / $0.25 cache read (0.025x) / $50.00 output per 1M.
 *
 * `toggleable: true` = effort is forwarded (see claude-opus-5-5.ts); thinking itself stays on.
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeFable51: ModelConfig = createClaudeModelConfig({
  id: 'claude-fable-5-1',
  displayName: 'Claude Fable 5.1',
  family: 'claude-fable-5.1',
  contextWindow: 1000000,
  outputTokens: 128000,
  inputCost: 10.0,
  cachedInputCost: 0.25,
  outputCost: 50.0,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved',
    toggleable: true
  },
  forcedToolChoice: false,
  samplingParams: false,
  supportsPTC: true
});
