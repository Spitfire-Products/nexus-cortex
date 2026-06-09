/**
 * GPT 5.1 Reasoning (gpt-5.1-reasoning)
 * OpenAI's advanced reasoning model with VISIBLE thinking traces
 *
 * Uses the Responses API with reasoning modality to expose chain-of-thought.
 * Tab toggle shows/hides reasoning traces.
 *
 * Best for: Tasks requiring visible step-by-step reasoning
 * Cost: $0.10 input / $0.30 output per million tokens
 * Note: Uses Responses API pattern with reasoning modality
 */

import { createOpenAIResponsesModelConfig } from '../../configurators/OpenAIResponsesConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

const baseConfig = createOpenAIResponsesModelConfig({
  id: 'gpt-5.1',  // Actual OpenAI model ID
  displayName: 'GPT 5.1 Reasoning',
  family: 'gpt-5',
  contextWindow: 2000000,
  outputTokens: 128000,
  inputCost: 0.10,
  outputCost: 0.30,
  supportsReasoning: true  // Enable reasoning modality for visible traces
});

// Override the internal ID for our registry while keeping the actual model ID for API calls
export const gpt51Reasoning: ModelConfig = {
  ...baseConfig,
  id: 'gpt-5.1-reasoning',  // Our registry ID (for /models switch)
  modelId: 'gpt-5.1' // Actual OpenAI API model ID
};
