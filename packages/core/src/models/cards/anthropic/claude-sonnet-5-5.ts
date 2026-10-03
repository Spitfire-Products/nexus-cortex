/**
 * Claude Sonnet 5.5 (claude-sonnet-5-5)
 * Successor to Sonnet 5 at the same price — the current Sonnet.
 *
 * Sources (2026-10-03):
 *  - GET /v1/models/claude-sonnet-5-5: max_input_tokens 1000000, max_tokens 128000;
 *    capabilities.thinking.types {enabled:false, adaptive:true}; effort low|medium|high|xhigh|max.
 *  - claude-api skill (model table, thinking/effort table, shared/model-migration.md
 *    "Migrating to Claude Sonnet 5.5"):
 *    · {type:'disabled'} and budget_tokens → 400. Thinking-off form is {type:'between_tools'} (no other
 *      field, effort high or below only). The harness never sends it: its "off" path omits `thinking`,
 *      which runs adaptive (always accepted).
 *    · Effort via output_config.effort; default `high`, levels recalibrated vs Sonnet 5.
 *    · Forced tool_choice `any`/`tool` → 400 → forcedToolChoice:false (gateway drops forced choices).
 *    · Preserved thinking: blocks bound to model + conversation; replay unchanged on the same model.
 *    · Non-default sampling values → 400; samplingParams:false (temperature + top_p never sent;
 *      live 2026-10-03 the configurator's top_p default 1.0 400'd: "`top_p` is deprecated for this model").
 *  - Pricing (vendor page, verified 2026-10-03): $2.00 input / $0.20 cache read / $10.00 output per 1M.
 *
 * `toggleable: true` = effort is forwarded (see claude-opus-5-5.ts); thinking itself stays on.
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeSonnet55: ModelConfig = createClaudeModelConfig({
  id: 'claude-sonnet-5-5',
  displayName: 'Claude Sonnet 5.5',
  family: 'claude-5.5',
  contextWindow: 1000000,
  outputTokens: 128000,
  inputCost: 2.0,
  cachedInputCost: 0.20,
  outputCost: 10.0,
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
