/**
 * Grok 4.3 (grok-4.3)
 * xAI flagship as of April 2026 — encrypted reasoning, server-side tools
 *
 * Best for: Complex agentic workflows, reasoning tasks, multimodal analysis
 * Cost: $0.30 input / $0.70 output per million tokens
 * Routes through /v1/responses by default when ENABLE_SERVER_SIDE_TOOLS is set
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok43: ModelConfig = createXAIModelConfig({
  id: 'grok-4.3',
  displayName: 'Grok 4.3',
  family: 'grok-4',
  contextWindow: 1000000,
  outputTokens: 131072,
  inputCost: 0.30,
  outputCost: 0.70,
  supportsReasoning: true,
  reasoningToggleable: false,
  reasoningEffort: 'high',
});
