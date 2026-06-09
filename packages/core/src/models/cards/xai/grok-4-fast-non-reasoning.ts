/**
 * Grok 4 Fast Non-Reasoning (grok-4-fast-non-reasoning)
 * XAI's ultra-fast variant of grok-4-fast with reasoning fully disabled
 *
 * Best for: High-throughput simple tasks (e.g., classification, extraction, basic Q&A)
 *           where minimal latency is critical; no internal reasoning loop
 * Cost: $0.20 input / $0.50 output per million tokens (plus $10/1K tool invocations)
 * Limits: 480 RPM, 4M TPM (same as base; no reasoning tokens expected)
 * Note: Identical to grok-4-fast but skips reasoning overhead for even lower latency/cost
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok4FastNonReasoning: ModelConfig = createXAIModelConfig({
  id: 'grok-4-fast-non-reasoning',
  displayName: 'Grok 4 Fast Non-Reasoning',
  family: 'grok-4',
  contextWindow: 2000000,
  outputTokens: 131072,
  inputCost: 0.20,
  outputCost: 0.50,
  supportsReasoning: false  // Explicitly disabled; no traces or tokens
});
