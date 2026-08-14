/**
 * Grok Build 0.1 — Messages API (grok-build-0.1)
 *
 * xAI's fast agentic-coding model (early access). This is the canonical
 * Messages-API card under the model's real name. `grok-code-fast-1` is an
 * alias of the same backend model and remains registered for back-compat; the
 * Responses-transport variant is `grok-build-0.1-responses`.
 *
 * Spec (xAI, early access):
 *   - Context window: 256,000 tokens
 *   - Modalities: text, image -> text
 *   - Function calling: yes · Structured outputs: yes · Reasoning: yes
 *   - Pricing: $1.00 input / $0.20 cached input / $2.00 output per 1M tokens
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grokBuild01: ModelConfig = createXAIModelConfig({
  id: 'grok-build-0.1',
  displayName: 'Grok Build 0.1',
  family: 'grok-code',
  contextWindow: 256000,
  outputTokens: 131072,
  inputCost: 1.00,
  cachedInputCost: 0.20,
  outputCost: 2.00,
  supportsReasoning: true,
  reasoningToggleable: false,  // Native interleaved thinking — always on
  // 🔴 TRANSPORT TAX (measured 2026-08-14): on /v1/messages this model bills a
  // ~16K-token fixed input overhead xAI-side — a bare "hi" request costs 24.5K
  // input vs 8.6K on grok-4.6 through the IDENTICAL harness path, and vs ~5.3K
  // for the SAME model on /v1/responses (historical avg, n=29 vs n=32).
  // Prefer grok-build-0.1-responses for cost-sensitive work; this messages pin
  // remains for interleaved-thinking parity benchmarking only.
  apiMode: 'messages',          // Pin to /v1/messages (preferred coding harness)
  // Messages route — ENABLE_SERVER_SIDE_TOOLS must not force this to Responses.
  supportsServerSideTools: false,
});
