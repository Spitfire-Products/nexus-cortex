/**
 * Grok Build 0.1 — chat/completions variant (grok-build-0.1-chat)
 *
 * Same backend model as `grok-build-0.1`, pinned to the THIRD xAI transport:
 * OpenAI-shape https://api.x.ai/v1/chat/completions through the SAME builder
 * the DeepSeek bench stack uses. Needed as its own card because the canonical
 * `grok-build-0.1` card is pinned to /v1/messages (XAI_API_MODE cannot move a
 * pinned card). A bench arm selects it by model id: `-m grok-build-0.1-chat`.
 * DARK/additive (2026-10-03).
 *
 * 🔴 NO reasoningEffort: grok-build-0.1 REJECTS the parameter (400 "does not
 * support parameter reasoningEffort", live 2026-10-02) — omitting it here is
 * the per-card capability gate the chat builder reads; do not add it.
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grokBuild01Chat: ModelConfig = createXAIModelConfig({
  id: 'grok-build-0.1-chat',
  modelId: 'grok-build-0.1',
  displayName: 'Grok Build 0.1 (Chat Completions)',
  family: 'grok-code',
  anchorProfile: 'bash-plus',   // same home door as the canonical card
  contextWindow: 256000,
  outputTokens: 131072,
  inputCost: 1.00,
  cachedInputCost: 0.20,
  outputCost: 2.00,
  supportsReasoning: true,
  reasoningToggleable: false,
  apiMode: 'chat',              // Pin to /v1/chat/completions regardless of XAI_API_MODE
});
