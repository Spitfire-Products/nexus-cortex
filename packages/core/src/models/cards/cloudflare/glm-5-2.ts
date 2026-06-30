/**
 * GLM 5.2 via Cloudflare Workers AI (@cf/zai-org/glm-5.2)
 *
 * Z.ai's flagship agentic coding model — reasoning + parallel tool calling.
 * Routed via CF Workers AI; no separate ZHIPU_API_KEY required.
 * Verified against the live Workers AI catalog 2026-06-30.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfGlm52: ModelConfig = createCloudflareModelConfig({
  id: '@cf/zai-org/glm-5.2',
  displayName: 'GLM 5.2 (Cloudflare)',
  family: 'glm',
  contextWindow: 262144,
  outputTokens: 8192,
  inputCost: 1.40,
  outputCost: 4.40,
  supportsReasoning: true,
});
