/**
 * Llama 4 Scout 17B (16 experts) via Cloudflare Workers AI
 * (@cf/meta/llama-4-scout-17b-16e-instruct)
 *
 * Mixture-of-experts. Vision + native tool calling.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfLlama4Scout: ModelConfig = createCloudflareModelConfig({
  id: '@cf/meta/llama-4-scout-17b-16e-instruct',
  displayName: 'Llama 4 Scout 17B (Cloudflare)',
  family: 'llama',
  contextWindow: 131072,
  outputTokens: 8192,
  inputCost: 0.15,
  outputCost: 0.45,
  supportsVision: true,
});
