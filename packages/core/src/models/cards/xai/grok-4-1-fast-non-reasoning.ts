/**
 * Grok 4.1 Fast Non-Reasoning (grok-4-1-fast-non-reasoning)
 * xAI's ultra-fast variant with reasoning fully disabled
 *
 * Aliases: grok-4-1-fast-non-reasoning-latest
 *
 * Best for: High-throughput simple tasks (e.g., classification, extraction, basic Q&A)
 *           where minimal latency is critical; no internal reasoning loop
 * Cost: $0.25 input / $0.60 output per million tokens (tools free until Nov 21, 2025; then $10/1K)
 * Limits: 500 RPM, 5M TPM; 1M native context (up to 2M cached)
 * Note: Identical to grok-4-1-fast-reasoning but skips reasoning overhead for even lower latency/cost
 */

import { createXAIModelConfig } from "../../configurators/XAIConfigurator.js";
import type { ModelConfig } from "../../ModelConfig.interface.js";

export const grok41FastNonReasoning: ModelConfig = createXAIModelConfig({
  id: "grok-4-1-fast-non-reasoning",
  displayName: "Grok 4.1 Fast Non-Reasoning",
  family: "grok-4",
  contextWindow: 1000000, // Clamped from 2M — budget manager can't efficiently manage 2M context
  outputTokens: 128000,
  inputCost: 0.2,
  outputCost: 0.5,
  supportsReasoning: false, // Explicitly disabled; no traces or tokens
});
