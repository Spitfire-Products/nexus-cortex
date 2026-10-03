/**
 * GPT-5.4 nano (gpt-5.4-nano)
 * Smallest GPT-5.4 tier — classification, extraction, ranking, high-volume helper work.
 *
 * Sources (2026-10-03):
 *  - developers.openai.com/api/docs/models/gpt-5.4-nano: 400,000 context window, 128,000 max
 *    output tokens; reasoning.effort none (default) | low | medium | high | xhigh; Chat Completions +
 *    Responses; function calling; knowledge cutoff 2025-08-31.
 *  - developers.openai.com/api/docs/pricing (Standard): $0.20 input / $0.02 cached / $1.25 output per 1M
 *    (no long-context rate listed).
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt54Nano: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5.4-nano',
  displayName: 'GPT-5.4 nano',
  family: 'gpt-5',
  contextWindow: 400000,
  outputTokens: 128000,
  inputCost: 0.20,
  cachedInputCost: 0.02,
  outputCost: 1.25,
  maxTokensParamName: 'max_completion_tokens',
  supportsServerSideTools: true,
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' }
});
