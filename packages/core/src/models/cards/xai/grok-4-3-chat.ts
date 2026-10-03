/**
 * Grok 4.3 — chat/completions variant (grok-4.3-chat)
 *
 * Same backend model as `grok-4.3`, pinned to the THIRD xAI transport:
 * OpenAI-shape https://api.x.ai/v1/chat/completions through the SAME builder
 * the DeepSeek bench stack uses (append-only prefix cache, reasoning_content
 * replay). Live theory test 2026-10-02 (.cortex/research/stack-portability-
 * 2026-10-02.md): tool loop works, prefix cache 99-100% from turn 1,
 * reasoning_effort honoured. Client tools only (no server-side tools on this
 * route). A bench arm selects it by model id: `-m grok-4.3-chat`.
 * DARK/additive (2026-10-03): the messages/responses cards are unchanged.
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok43Chat: ModelConfig = createXAIModelConfig({
  id: 'grok-4.3-chat',
  modelId: 'grok-4.3',
  displayName: 'Grok 4.3 (Chat Completions)',
  family: 'grok-4',
  contextWindow: 1000000,
  outputTokens: 131072,
  inputCost: 0.30,
  outputCost: 0.70,
  supportsReasoning: true,
  reasoningToggleable: false,
  reasoningEffort: 'high',      // capability signal: reasoning_effort IS sent on this card (request/action effort overrides)
  apiMode: 'chat',              // Pin to /v1/chat/completions regardless of XAI_API_MODE
});
