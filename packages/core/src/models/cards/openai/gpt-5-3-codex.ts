/**
 * GPT-5.3-Codex (gpt-5.3-codex)
 * Agentic coding model; Responses API only.
 *
 * Sources (2026-10-03):
 *  - developers.openai.com/api/docs/models/gpt-5.3-codex: 400,000 context window (max input 272,000),
 *    128,000 max output tokens; reasoning effort low | medium | high | xhigh; only /v1/responses
 *    (Chat Completions NOT supported) → Responses configurator; function calling, streaming, structured
 *    outputs, image input, prompt caching; knowledge cutoff 2025-08-31.
 *  - developers.openai.com/api/docs/pricing (Standard, specialized models): $1.75 input / $0.175 cached /
 *    $14.00 output per 1M.
 *  - Sampling params off (samplingParams:false) — see gpt-5-5-pro.ts.
 * contextWindow carries the 400K total; the model doc caps INPUT at 272K.
 */

import { createOpenAIResponsesModelConfig } from '../../configurators/OpenAIResponsesConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt53Codex: ModelConfig = createOpenAIResponsesModelConfig({
  id: 'gpt-5.3-codex',
  displayName: 'GPT-5.3-Codex',
  family: 'gpt-5',
  contextWindow: 400000,
  outputTokens: 128000,
  inputCost: 1.75,
  cachedInputCost: 0.175,
  outputCost: 14.0,
  supportsReasoning: true,
  samplingParams: false
});
