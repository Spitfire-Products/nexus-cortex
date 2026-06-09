/**
 * Kimi K2.6 via Cloudflare Workers AI (@cf/moonshotai/kimi-k2.6)
 * Moonshot's 1T-param flagship — reasoning, vision, native tool calling.
 *
 * Routed via CF Workers AI OpenAI-compatible endpoint.
 * Parity with nexus-terminal CORTEX registry (2026-05-14).
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfKimiK26: ModelConfig = createCloudflareModelConfig({
  id: '@cf/moonshotai/kimi-k2.6',
  displayName: 'Kimi K2.6 (Cloudflare)',
  family: 'kimi',
  contextWindow: 262144,
  outputTokens: 8192,
  inputCost: 0.50,
  outputCost: 1.50,
  supportsReasoning: true,
  supportsVision: true,
});
