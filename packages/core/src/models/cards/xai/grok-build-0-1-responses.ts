/**
 * Grok Build 0.1 — Responses API variant (grok-build-0.1-responses)
 *
 * xAI's fast agentic-coding model, pinned to the /v1/responses transport so it
 * can be benchmarked head-to-head against the Messages-API route (which is
 * already served by the `grok-code-fast-1` card — an alias of grok-build-0.1).
 *
 * Wire model name: grok-build-0.1 (sent via `modelId`; the registry id carries
 * the `-responses` suffix only to distinguish the transport variant).
 *
 * Spec (xAI, early access):
 *   - Context window: 256,000 tokens
 *   - Modalities: text, image -> text
 *   - Function calling: yes · Structured outputs: yes · Reasoning: yes
 *   - Pricing: $1.00 input / $0.20 cached input / $2.00 output per 1M tokens
 *
 * Responses transport additionally unlocks xAI server-side tools (web_search,
 * x_search, code_execution, ...) and stateful response chaining.
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grokBuild01Responses: ModelConfig = createXAIModelConfig({
  id: 'grok-build-0.1-responses',
  modelId: 'grok-build-0.1',
  displayName: 'Grok Build 0.1 (Responses)',
  family: 'grok-code',
  contextWindow: 256000,
  outputTokens: 131072,
  inputCost: 1.00,
  cachedInputCost: 0.20,
  outputCost: 2.00,
  supportsReasoning: true,
  reasoningToggleable: false,  // Native interleaved thinking — always on
  // NOTE: grok-build-0.1 supports reasoning but NOT the reasoningEffort param on
  // /v1/responses (xAI 400: "does not support parameter reasoningEffort").
  // Verified via smoke test — do not re-add reasoningEffort here.
  apiMode: 'responses',        // Pin to /v1/responses regardless of XAI_API_MODE
  supportsServerSideTools: true,
});
