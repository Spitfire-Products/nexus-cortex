/**
 * Qwen 3 Coder (qwen-3-coder)
 * Alibaba Cloud's specialized coding model
 *
 * Best for: Code generation, code understanding, programming tasks
 * Cost: $0.28 input / $1.12 output per million tokens
 *
 * Features:
 * - 32K context window
 * - Optimized for coding tasks
 * - Multiple programming languages
 * - Code completion and generation
 * - Very cost-effective
 */

import { createQwenModelConfig } from '../../configurators/QwenConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const qwen3Coder: ModelConfig = createQwenModelConfig({
  id: 'qwen-3-coder',
  displayName: 'Qwen 3 Coder',
  family: 'qwen-3',
  contextWindow: 32000,
  outputTokens: 8192,
  inputCost: 0.28,
  outputCost: 1.12,
  supportsTools: true,
  supportsVision: false
});
