/**
 * Hugging Face Model Configurator
 *
 * Factory for HF Inference Providers model configs. Routes through the OpenAI-compatible
 * router (router.huggingface.co) with server-side provider selection.
 *
 * API Docs: https://huggingface.co/docs/inference-providers/index
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface HuggingFaceModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost?: number;      // Optional — provider-dependent; free tier + PRO credits
  outputCost?: number;     // Optional — provider-dependent; free tier + PRO credits
  supportsTools?: boolean;

  /**
   * Hugging Face model ID (e.g., 'openai/gpt-oss-120b'). Sent as the request-body
   * "model". If not provided, uses the 'id' field.
   */
  huggingFaceModelId?: string;

  /**
   * For a dedicated HF Inference Endpoint (optional)
   * Format: https://[endpoint-id].[region].aws.endpoints.huggingface.cloud/v1/chat/completions
   */
  customEndpoint?: string;
}

export function createHuggingFaceModelConfig(options: HuggingFaceModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : false;
  // The HF repo id (e.g. "meta-llama/Llama-3.1-8B-Instruct"). Sent as the request-body
  // "model" (= config.id), matching the OpenAI card convention (id === API model name).
  // Append a policy/provider suffix to steer routing: ":fastest" (default), ":cheapest",
  // or ":together" / ":groq" / etc. for a specific provider.
  const modelId = options.huggingFaceModelId || options.id;

  // HF Inference Providers OpenAI-compatible router (auto provider selection). The legacy
  // api-inference.huggingface.co host is deprecated. NOTE: the router hosts mostly larger
  // popular models via partner providers — small models are typically NOT served, so use
  // a local card for those. Override with customEndpoint for a dedicated endpoint.
  const endpoint = options.customEndpoint ||
                  'https://router.huggingface.co/v1/chat/completions';

  return {
    id: modelId,
    provider: 'huggingface',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',  // Hugging Face uses OpenAI-compatible format
      endpoint: endpoint,
      apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: supportsTools,
      adapter: 'ChatCompletionsAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: supportsTools ? 128 : 0,
      parallelToolCalls: supportsTools
    },

    parameters: {
      temperature: {
        supported: true,
        paramName: 'temperature',
        min: 0.0,
        max: 2.0
      },
      maxTokens: {
        supported: true,
        paramName: 'max_tokens',
        default: 2048,
        min: 1,
        max: options.outputTokens
      },
      topP: {
        supported: true,
        paramName: 'top_p',
        default: 0.95,
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 100,    // Serverless API limits
      tokensPerMinute: 100000    // Varies by tier
    },

    streaming: {
      supported: true,
      format: 'sse'
    },

    compaction: {
      strategy: 'auto',
      thresholdCalculation: {
        method: 'percentage',
        percentage: 0.8,
        safetyMargin: 4000
      },
      behavior: {
        preserveRecent: 10,
        compactOlder: true,
        useHelperModel: false
      }
    },

    cost: {
      inputPerMillion: options.inputCost || 0.0,   // Serverless is free (rate-limited)
      outputPerMillion: options.outputCost || 0.0
    }
  };
}
