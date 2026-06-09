/**
 * Grok 4 Fast (grok-4-fast)
 * XAI's fastest cost-efficient reasoning model with 2M context window
 *
 * Best for: Agentic workflows, speed-critical tasks, long-context analysis, server-side tools
 *           (Internal reasoning with token monitoring; no exposed traces for efficiency)
 * Cost: $0.20 input / $0.50 output per million tokens (plus $10/1K tool invocations)
 * Limits: 480 RPM, 4M TPM
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok4Fast: ModelConfig = createXAIModelConfig({
  id: 'grok-4-fast',
  displayName: 'Grok 4 Fast',
  family: 'grok-4',
  contextWindow: 2000000,
  outputTokens: 131072,
  inputCost: 0.20,
  outputCost: 0.50,
  supportsReasoning: false  // Internal reasoning only; no trace exposure
});
