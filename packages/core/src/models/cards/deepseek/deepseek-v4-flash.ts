/**
 * DeepSeek V4 Flash (deepseek-v4-flash)
 * DeepSeek's fast V4 model — 284B total / 13B active params, 1M context
 *
 * Best for: Fast general tasks, coding, tool use at scale
 * Cost: $0.14 input / $0.28 output per million tokens
 * Supersedes deepseek-chat. Dual-mode (thinking/non-thinking).
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekV4Flash: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-v4-flash',
  displayName: 'DeepSeek V4 Flash',
  family: 'deepseek-v4',
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.14,
  outputCost: 0.28,
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
