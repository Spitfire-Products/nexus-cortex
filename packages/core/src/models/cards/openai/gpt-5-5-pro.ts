/**
 * GPT-5.5 Pro (gpt-5.5-pro)
 * High-compute GPT-5.5 for the hardest problems; requests can run several minutes.
 *
 * Sources (2026-10-03):
 *  - developers.openai.com/api/docs/models/gpt-5.5-pro: 1,050,000 context window, 128,000 max output
 *    tokens; reasoning.effort medium | high (default) | xhigh — no `none`/`low`; Responses + Batch only
 *    (Chat Completions NOT supported) → Responses configurator; function calling; knowledge cutoff
 *    2025-12-01; "some requests may take several minutes … try using background mode".
 *  - developers.openai.com/api/docs/pricing (Standard): $30.00 input / $180.00 output per 1M (short
 *    context ≤272K); long context $60.00 / $270.00. No cached-input rate listed.
 *  - Sampling params off (samplingParams:false): the Responses top_p default 400s on GPT-5.x reasoning
 *    models (verified on gpt-5.6-sol 2026-10-03).
 */

import { createOpenAIResponsesModelConfig } from '../../configurators/OpenAIResponsesConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt55Pro: ModelConfig = createOpenAIResponsesModelConfig({
  id: 'gpt-5.5-pro',
  displayName: 'GPT-5.5 Pro',
  family: 'gpt-5',
  contextWindow: 1050000,
  outputTokens: 128000,
  inputCost: 30.0,
  outputCost: 180.0,
  supportsReasoning: true,
  samplingParams: false
});
