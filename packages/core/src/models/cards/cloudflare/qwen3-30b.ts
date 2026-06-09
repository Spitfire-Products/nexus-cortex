/**
 * Qwen3 30B FP8 via Cloudflare Workers AI (@cf/qwen/qwen3-30b-a3b-fp8)
 *
 * CORTEX notes: "Cheapest tool-calling model." Reasoning + native tools.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfQwen330b: ModelConfig = createCloudflareModelConfig({
  id: '@cf/qwen/qwen3-30b-a3b-fp8',
  displayName: 'Qwen3 30B (Cloudflare)',
  family: 'qwen',
  contextWindow: 32768,
  outputTokens: 8192,
  inputCost: 0.10,
  outputCost: 0.30,
  supportsReasoning: true,
});
