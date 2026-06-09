/**
 * Kimi K2 Instruct (kimi-k2-instruct)
 * Moonshot AI's Kimi K2 instruction-tuned model
 *
 * Best for: Chinese language tasks, long context, instruction following
 * Cost: $0.50 input / $2.00 output per million tokens
 *
 * Features:
 * - 128K context window
 * - Strong Chinese language support
 * - Instruction-tuned for better following
 * - Long context understanding
 * - Function calling support
 */

import { createMoonshotModelConfig } from '../../configurators/MoonshotConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const kimiK2Instruct: ModelConfig = createMoonshotModelConfig({
  id: 'kimi-k2-instruct',
  displayName: 'Kimi K2 Instruct',
  family: 'kimi-k2',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 0.50,
  outputCost: 2.00,
  supportsTools: true
});
