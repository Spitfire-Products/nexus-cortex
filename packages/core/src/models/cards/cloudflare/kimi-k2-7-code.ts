/**
 * Kimi K2.7 Code via Cloudflare Workers AI (@cf/moonshotai/kimi-k2.7-code)
 *
 * Moonshot's frontier-scale coding model — multi-turn native tool calling.
 * Routed via CF Workers AI OpenAI-compatible endpoint.
 * Verified against the live Workers AI catalog 2026-06-30.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfKimiK27Code: ModelConfig = createCloudflareModelConfig({
  id: '@cf/moonshotai/kimi-k2.7-code',
  displayName: 'Kimi K2.7 Code (Cloudflare)',
  family: 'kimi',
  contextWindow: 262144,
  outputTokens: 8192,
  inputCost: 0.95,
  outputCost: 4.00,
  cachedInputCost: 0.19, // CF prefix-cached input (verified live pricing 2026-06-30)
  supportsReasoning: true,
});
