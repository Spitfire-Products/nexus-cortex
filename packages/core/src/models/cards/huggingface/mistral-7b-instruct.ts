/**
 * Mistral 7B Instruct (Hugging Face)
 * Mistral AI's 7B model via Hugging Face Inference API
 *
 * Best for: Fast inference, balanced performance
 * Cost: FREE (serverless API, rate-limited)
 */

import { createHuggingFaceModelConfig } from '../../configurators/HuggingFaceConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const mistral7bInstructHF: ModelConfig = createHuggingFaceModelConfig({
  id: 'mistral-7b-instruct-hf',
  displayName: 'Mistral 7B Instruct (HF)',
  family: 'mistral',
  huggingFaceModelId: 'mistralai/Mistral-7B-Instruct-v0.2',
  contextWindow: 32768,
  outputTokens: 4096,
  supportsTools: false
});
