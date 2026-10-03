/**
 * Grok 4.7 (grok-4.7)
 * "SpaceXAI's frontier model for coding, agentic tasks, and knowledge work" (xAI docs).
 *
 * Sources (2026-10-03):
 *  - xAI docs developers/models/grok-4.7: text+image → text, 500,000-token context, function calling,
 *    structured outputs, reasoning; reasoning efforts low | medium | high | xhigh (default high) —
 *    no `none`, so reasoning cannot be disabled (toggleable:false). Batch API not supported.
 *    150 RPS / 50M TPM; us-east-1, us-west-2, us-central-1.
 *  - GET /v1/language-models/grok-4.7: capabilities.reasoning_effort [low, medium, high, xhigh],
 *    default_reasoning_effort high; prompt 20000 / cached 5000 / completion 60000 (1e-4 $/1M units)
 *    = $2.00 / $0.50 / $6.00 per 1M; long_context_threshold 200000 → $4.00 / $1.00 / $12.00
 *    ("billed at the higher rate for all tokens in the request"). The card carries the <200K rate flat
 *    (grok-4.5/4.6 convention). aliases: [].
 *  - Max output tokens: NOT published (docs page or /language-models) — grok-4 family default 131072,
 *    same as grok-4.6 (unverified).
 *
 * Transport: pinned to /v1/messages (the interleaved-thinking path) via the UNCHANGED XAIConfigurator
 * messages mode — no xAI Messages request/thinking code touched. The chat/completions twin is
 * grok-4.7-chat. No anchorProfile: grok-4.6's bash-plus anchor was swept on 4.6 only.
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok47: ModelConfig = createXAIModelConfig({
  id: 'grok-4.7',
  displayName: 'Grok 4.7',
  family: 'grok-4',
  contextWindow: 500000,
  outputTokens: 131072,
  inputCost: 2.00,
  cachedInputCost: 0.50,
  outputCost: 6.00,
  supportsReasoning: true,
  reasoningToggleable: false,
  reasoningEffort: 'high',
  apiMode: 'messages',
});
