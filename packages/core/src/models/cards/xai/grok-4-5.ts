/**
 * Grok 4.5 (grok-4.5)
 * xAI flagship as of July 2026 — reasoning, function calling, structured
 * outputs, vision input. Aliases: grok-4.5-latest, grok-build-latest.
 *
 * Specs from the xAI docs (developers/models/grok-4.5, pulled 2026-07-09):
 * 500K context · $2.00 input / $0.50 cached input / $6.00 output per M ·
 * 150 RPS / 50M TPM. Max output tokens not published — using the grok-4
 * family default (131072).
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok45: ModelConfig = createXAIModelConfig({
  id: 'grok-4.5',
  displayName: 'Grok 4.5',
  family: 'grok-4',
  contextWindow: 500000,
  outputTokens: 131072,
  inputCost: 2.00,
  cachedInputCost: 0.50,
  outputCost: 6.00,
  supportsReasoning: true,
  reasoningToggleable: false,
  reasoningEffort: 'high',
});
