/**
 * Kimi K2.5 via Cloudflare Workers AI (@cf/moonshotai/kimi-k2.5)
 * Predecessor to K2.6. Reasoning + vision + native tool calling.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfKimiK25: ModelConfig = createCloudflareModelConfig({
  id: '@cf/moonshotai/kimi-k2.5',
  displayName: 'Kimi K2.5 (Cloudflare)',
  family: 'kimi',
  contextWindow: 256000,
  outputTokens: 8192,
  inputCost: 0.40,
  outputCost: 1.20,
  supportsReasoning: true,
  supportsVision: true,
});
