/**
 * Llama 3 8B Instruct (Hugging Face)
 * Meta's Llama 3 8B via Hugging Face Inference API
 *
 * Best for: Open-source alternative, serverless inference
 * Cost: FREE (serverless API, rate-limited)
 *
 * Setup:
 * 1. Get API key from: https://huggingface.co/settings/tokens
 * 2. Set HUGGINGFACE_API_KEY environment variable
 * 3. Model loads on first request (may take 20-30 seconds)
 *
 * Note: Serverless API is rate-limited. For production, use dedicated endpoints.
 */

import { createHuggingFaceModelConfig } from '../../configurators/HuggingFaceConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const llama38bInstructHF: ModelConfig = createHuggingFaceModelConfig({
  id: 'llama-3-8b-instruct-hf',
  displayName: 'Llama 3 8B Instruct (HF)',
  family: 'llama-3',
  huggingFaceModelId: 'meta-llama/Meta-Llama-3-8B-Instruct',
  contextWindow: 8192,
  outputTokens: 2048,
  supportsTools: false
});
