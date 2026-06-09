/**
 * Grok Code Fast (grok-code-fast-1)
 * XAI's specialized coding model with 256K context window
 *
 * Best for: Code generation, debugging, technical tasks
 * Cost: $0.20 input / $1.50 output per million tokens
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grokCodeFast1: ModelConfig = createXAIModelConfig({
  id: 'grok-code-fast-1',
  displayName: 'Grok Code Fast',
  family: 'grok-code',
  contextWindow: 256000,
  outputTokens: 131072,
  inputCost: 0.20,
  outputCost: 1.50,
  supportsReasoning: true,
  reasoningToggleable: false,  // Native interleaved thinking — always on, Tab shows "always visible" message
  // Messages API only — ENABLE_SERVER_SIDE_TOOLS must not force this to Responses
  supportsServerSideTools: false,
});
