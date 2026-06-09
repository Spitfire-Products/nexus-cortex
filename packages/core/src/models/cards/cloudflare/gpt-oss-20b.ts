/**
 * GPT-OSS 20B via Cloudflare Workers AI (@cf/openai/gpt-oss-20b)
 *
 * OpenAI's open-weight 20B model. NOT available through OpenAI's own API.
 * Smaller / cheaper variant of gpt-oss-120b.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfGptOss20b: ModelConfig = createCloudflareModelConfig({
  id: '@cf/openai/gpt-oss-20b',
  displayName: 'GPT-OSS 20B (Cloudflare)',
  family: 'gpt-oss',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 0.15,
  outputCost: 0.50,
  supportsReasoning: true,
});
