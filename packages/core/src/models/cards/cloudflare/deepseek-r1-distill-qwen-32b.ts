/**
 * DeepSeek R1 Distill Qwen 32B via Cloudflare Workers AI
 * (@cf/deepseek-ai/deepseek-r1-distill-qwen-32b)
 *
 * R1-distilled reasoning into a Qwen 32B backbone — tool calling supported.
 * Routed via CF Workers AI OpenAI-compatible endpoint.
 * Verified against the live Workers AI catalog 2026-06-30 (org = deepseek-ai).
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfDeepseekR1Distill32b: ModelConfig = createCloudflareModelConfig({
  id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  displayName: 'DeepSeek R1 Distill Qwen 32B (Cloudflare)',
  family: 'deepseek',
  contextWindow: 80000,
  outputTokens: 8192,
  inputCost: 0.50,
  outputCost: 4.88,
  supportsReasoning: true,
});
