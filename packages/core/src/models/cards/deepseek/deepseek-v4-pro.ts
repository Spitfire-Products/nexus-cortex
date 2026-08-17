/**
 * DeepSeek V4 Pro (deepseek-v4-pro)
 * DeepSeek's flagship V4 model — 1.6T total / 49B active params, 1M context
 *
 * Best for: Complex reasoning, coding, deep analysis
 * Cost: $0.50 input / $2.00 output per million tokens
 * Supersedes deepseek-reasoner. Dual-mode (thinking/non-thinking).
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekV4Pro: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-v4-pro',
  displayName: 'DeepSeek V4 Pro',
  family: 'deepseek-v4',

  // Home-door anchor (P1pro 2026-08-17: anchored -35% latency at ceiling; bash-edit untested on pro — conservative bash-plus).
  anchorProfile: 'bash-plus',
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.50,
  outputCost: 2.0,
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
