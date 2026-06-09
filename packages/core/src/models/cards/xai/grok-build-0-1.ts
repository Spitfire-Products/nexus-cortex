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
  apiMode: 'messages',          // Pin to /v1/messages (preferred coding harness)
  // Messages route — ENABLE_SERVER_SIDE_TOOLS must not force this to Responses.
  supportsServerSideTools: false,
});
