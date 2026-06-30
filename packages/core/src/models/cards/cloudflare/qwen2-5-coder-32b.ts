/**
 * Qwen2.5 Coder 32B Instruct via Cloudflare Workers AI
 * (@cf/qwen/qwen2.5-coder-32b-instruct)
 *
 * Alibaba's code-specialized 32B — native tool calling. Not a reasoning model.
 * Verified against the live Workers AI catalog 2026-06-30.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfQwen25Coder32b: ModelConfig = createCloudflareModelConfig({
  id: '@cf/qwen/qwen2.5-coder-32b-instruct',
  displayName: 'Qwen2.5 Coder 32B (Cloudflare)',
  family: 'qwen',
  contextWindow: 32768,
  outputTokens: 8192,
  inputCost: 0.66,
  outputCost: 1.00,
  supportsReasoning: false,
});
