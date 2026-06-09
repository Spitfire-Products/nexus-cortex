/**
 * Gemma 4 26B A4B via Cloudflare Workers AI (@cf/google/gemma-4-26b-a4b-it)
 * Google's Gemma 4 instruction-tuned model. Reasoning + vision + tools.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfGemma426b: ModelConfig = createCloudflareModelConfig({
  id: '@cf/google/gemma-4-26b-a4b-it',
  displayName: 'Gemma 4 26B A4B (Cloudflare)',
  family: 'gemma',
  contextWindow: 256000,
  outputTokens: 8192,
  inputCost: 0.20,
  outputCost: 0.60,
  supportsReasoning: true,
  supportsVision: true,
});
