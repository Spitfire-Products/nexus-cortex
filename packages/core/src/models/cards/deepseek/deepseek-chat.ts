/**
 * DeepSeek Chat (deepseek-chat)
 * General purpose conversational model
 *
 * Best for: General conversations, Q&A
 * Cost: $0.14 input / $0.28 output per million tokens
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekChat: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-chat',
  displayName: 'DeepSeek Chat',
  family: 'deepseek',
  contextWindow: 64000,
  outputTokens: 8192,
  inputCost: 0.14,
  outputCost: 0.28
});
