/**
 * GPT 5.1 (gpt-5.1)
 * OpenAI's advanced reasoning model with multimodal support and o1-style chain-of-thought
 *
 * Best for: Enterprise agents, RAG/multimodal tasks, fine-tuning, low-hallucination extraction
 * Cost: $0.10 input / $0.30 output per million tokens (tools $5/1K)
 * Limits: 1K RPM, 10M TPM; 2M context (up to 4M cached)
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt51: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.1',
  displayName: 'GPT 5.1',
  family: 'gpt-5',
  contextWindow: 2000000,
  outputTokens: 128000,
  inputCost: 0.10,
  outputCost: 0.30,
  maxTokensParamName: 'max_completion_tokens', // GPT-5 uses max_completion_tokens
  supportsServerSideTools: true, // R20: dynamic /v1/responses switch when hosted tools requested
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }  // Full traces with configurable effort (low/high)
});