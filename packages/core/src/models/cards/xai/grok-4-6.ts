/**
 * Grok 4.6 (grok-4.6)
 * xAI frontier model as of 2026-08-12 — "the most intelligent and fastest model
 * we've built" (xAI docs). Coding, agentic tasks, knowledge work. Reasoning,
 * function calling, structured outputs, vision input. Knowledge cutoff 2026-02-01.
 *
 * Specs from the xAI docs (developers/models/grok-4.6, pulled 2026-08-12):
 * 500K context · text+image→text · 150 RPS / 50M TPM · regions us-east-1, us-west-2.
 * Pricing (<200k prompt): $2.00 input / $0.50 cached input / $6.00 output per M.
 * (Tiered ≥200k: $4/$1/$12 — the card carries the <200k rate flat, matching the
 * grok-4.5 convention; the harness under-estimates cost only on >200k prompts.)
 * Max output tokens not published — grok-4 family default (131072).
 *
 * Config is a clean clone of grok-4.5: same 500k/pricing/reasoning, same wire
 * behavior. Default transport = Messages API (interleaved thinking via
 * `reasoning_content`); Responses backend (server-side tools) carries encrypted
 * reasoning — both handled by XAIConfigurator, no 4.6-specific quirk. Note (docs):
 * `logprobs`/`top_logprobs` are silently ignored on grok-4.20-and-newer — the
 * harness never sends them, so no impact.
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok46: ModelConfig = createXAIModelConfig({
  id: 'grok-4.6',
  displayName: 'Grok 4.6',
  family: 'grok-4',
  contextWindow: 500000,
  outputTokens: 131072,
  inputCost: 2.00,
  cachedInputCost: 0.50,
  outputCost: 6.00,
  supportsReasoning: true,
  reasoningToggleable: false,
  reasoningEffort: 'high',
  apiMode: 'messages',   // Pin to /v1/messages — the interleaved-thinking path.
                         // The Responses transport is the separate grok-4.6-responses card.
});
