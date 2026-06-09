/**
 * Nemotron 3 120B via Cloudflare Workers AI (@cf/nvidia/nemotron-3-120b-a12b)
 * NVIDIA's 120B model. Reasoning + native tool calling.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfNemotron3: ModelConfig = createCloudflareModelConfig({
  id: '@cf/nvidia/nemotron-3-120b-a12b',
  displayName: 'Nemotron 3 120B (Cloudflare)',
  family: 'nemotron',
  contextWindow: 256000,
  outputTokens: 8192,
  inputCost: 0.40,
  outputCost: 1.20,
  supportsReasoning: true,
});
