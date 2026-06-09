/**
 * DeepSeek Reasoner (deepseek-reasoner)
 * Advanced reasoning model for complex problem solving
 *
 * Best for: Complex reasoning tasks, logic problems
 * Cost: $0.14 input / $0.28 output per million tokens
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekReasoner: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-reasoner',
  displayName: 'DeepSeek Reasoner',
  family: 'deepseek',
  contextWindow: 64000,
  outputTokens: 8192,
  inputCost: 0.14,
  outputCost: 0.28,
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block',
    pattern: 'interleaved'
  }
});
