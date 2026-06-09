/**
 * Llama 3.3 70B FP8 Fast via Cloudflare Workers AI
 * (@cf/meta/llama-3.3-70b-instruct-fp8-fast)
 *
 * FP8-quantized, latency-optimized variant. Native tool calling.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfLlama3370b: ModelConfig = createCloudflareModelConfig({
  id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  displayName: 'Llama 3.3 70B (Cloudflare)',
  family: 'llama',
  contextWindow: 131072,
  outputTokens: 8192,
  inputCost: 0.25,
  outputCost: 0.75,
});
