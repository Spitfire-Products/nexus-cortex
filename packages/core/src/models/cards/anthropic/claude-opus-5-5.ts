/**
 * Claude Opus 5.5 (claude-opus-5-5)
 * Successor to Opus 5 in the Opus line at a lower price; the current Opus.
 *
 * Sources (2026-10-03):
 *  - GET /v1/models/claude-opus-5-5: max_input_tokens 1000000, max_tokens 128000;
 *    capabilities.thinking.types {enabled:false, adaptive:true}; effort low|medium|high|xhigh|max.
 *  - claude-api skill (model table, thinking/effort table, shared/model-migration.md
 *    "Migrating to Claude Opus 5.5"):
 *    · Thinking cannot be disabled: {type:'disabled'} AND budget_tokens 400 at every effort.
 *      Omitting `thinking` runs adaptive → the harness's disableThinking path (omit) is safe.
 *    · Effort via output_config.effort; DEFAULT IS `medium` (Opus 5 was `high`) — the harness
 *      sends effort only under CORTEX_ANTHROPIC_EFFORT, otherwise the API default (medium) applies.
 *    · Forced tool_choice `any`/`tool` → 400 → forcedToolChoice:false (gateway drops forced choices).
 *    · Preserved thinking: thinking blocks are bound to model + conversation; replay them unchanged on
 *      the same model (MessagesAPIAdapter replays blocks with their signature). Editing earlier turns
 *      invalidates them (400 on accounts created on/after 2026-08-31).
 *    · Sampling params (temperature/top_p/top_k) removed → 400; samplingParams:false (temperature + top_p never sent;
 *      live 2026-10-03 the configurator's top_p default 1.0 400'd: "`top_p` is deprecated for this model").
 *    · No assistant prefill; computer use only via computer_toolset_20260801 on the Claude API.
 *  - Pricing (vendor page, verified 2026-10-03): $4.00 input / $0.20 cache read (0.05x) / $20.00 output per 1M.
 *
 * `toggleable: true` = the request/action effort is forwarded (gateway → output_config.effort under
 * CORTEX_ANTHROPIC_EFFORT). It does NOT mean thinking can be switched off: "off" omits the param,
 * which still runs adaptive.
 */

import { createClaudeModelConfig } from '../../configurators/AnthropicConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeOpus55: ModelConfig = createClaudeModelConfig({
  id: 'claude-opus-5-5',
  displayName: 'Claude Opus 5.5',
  family: 'claude-5.5',
  contextWindow: 1000000,
  outputTokens: 128000,
  inputCost: 4.0,
  cachedInputCost: 0.20,
  outputCost: 20.0,
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
