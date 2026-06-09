/**
 * GPT-5.2 (gpt-5.2)
 * OpenAI's enhanced GPT-5.2 model with extended context
 *
 * Released: December 11, 2025
 * Best for: Enterprise coding, agentic tasks, long context processing
 * Cost: $1.75 input / $14.00 output per million tokens
 *
 * Features:
 * - 400K context window (largest OpenAI model)
 * - 128K max output tokens
 * - Interleaved reasoning with tool use
 * - reasoning.effort parameter for controlling CoT depth
 * - Knowledge cutoff: August 31, 2025
 * - Multimodal: text and image I/O
 * - Function calling and structured outputs
 * - 90% discount on cached inputs
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt52: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.2',
  displayName: 'GPT-5.2',
  family: 'gpt-5',
  contextWindow: 400000,
  outputTokens: 128000,
  inputCost: 1.75,
  outputCost: 14.0,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true, // R20: dynamic /v1/responses switch when hosted tools requested
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
