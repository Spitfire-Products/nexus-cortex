/**
 * Kimi K2 Thinking (kimi-k2-thinking)
 * Moonshot AI's Kimi K2 model with extended thinking/reasoning mode
 *
 * Best for: Complex reasoning, step-by-step problem solving, Chinese language analysis
 * Cost: $0.50 input / $2.00 output per million tokens
 *
 * Features:
 * - 128K context window
 * - Extended reasoning mode
 * - Chain-of-thought processing
 * - Strong Chinese language support
 * - Step-by-step problem solving
 * - Function calling support
 */

import { createMoonshotModelConfig } from '../../configurators/MoonshotConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const kimiK2Thinking: ModelConfig = createMoonshotModelConfig({
  id: 'kimi-k2-thinking',
  displayName: 'Kimi K2 Thinking',
  family: 'kimi-k2',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 0.50,
  outputCost: 2.00,
  supportsTools: true
});
