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

  // Home-door anchor (P4 sweep 2026-08-17: bash-edit anchor = 14/14, -47% output tokens vs control; cue line REFUTED (hurts in our dialect)).
  anchorProfile: 'bash-edit',
  // P6c/P6e/P6f/P6g family verdict (2026-08-18): boot-observation minimal beats
  // the full corpus at equal accuracy on short AND long tasks, both members
  // (BASH_PLUS_SPEC P6 series). Env levers override per session.
  promptPreset: 'boot-minimal',
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
