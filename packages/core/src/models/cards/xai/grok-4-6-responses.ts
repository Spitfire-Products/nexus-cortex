/**
 * Grok 4.6 — Responses API variant (grok-4.6-responses)
 *
 * xAI's frontier model pinned to the /v1/responses transport so it can be
 * benchmarked head-to-head against the Messages-API route (the `grok-4.6` card).
 * Responses additionally unlocks xAI server-side tools (web_search, x_search,
 * code_execution, ...) + stateful response chaining, and carries ENCRYPTED
 * reasoning (opaque server-side; vs the plaintext `reasoning_content` on Messages).
 *
 * Wire model name: grok-4.6 (via `modelId`; the registry id carries `-responses`
 * only to distinguish the transport variant).
 *
 * Spec (xAI docs, 2026-08-12): 500K context · text+image→text · $2/$0.50/$6 per M
 * (<200k). reasoningEffort: grok-4.3/4.5 support it on /v1/responses, so grok-4.6
 * (grok-4 family) is carded WITH it; if a smoke test returns the xAI 400 "does not
 * support parameter reasoningEffort" (as grok-build-0.1 does), drop it here.
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok46Responses: ModelConfig = createXAIModelConfig({
  id: 'grok-4.6-responses',
  modelId: 'grok-4.6',
  displayName: 'Grok 4.6 (Responses)',
  family: 'grok-4',
  contextWindow: 500000,
  outputTokens: 131072,
  inputCost: 2.00,
  cachedInputCost: 0.50,
  outputCost: 6.00,
  supportsReasoning: true,
  reasoningToggleable: false,
  reasoningEffort: 'high',
  apiMode: 'responses',        // Pin to /v1/responses regardless of XAI_API_MODE
  supportsServerSideTools: true,
});
