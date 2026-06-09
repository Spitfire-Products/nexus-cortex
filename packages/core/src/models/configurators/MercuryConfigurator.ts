/**
 * Mercury (Inception Labs) Model Configurator
 *
 * Factory for Inception Labs Mercury models — diffusion LLMs (dLLM) served over
 * an OpenAI-compatible Chat Completions API. Verified against the live model
 * list at https://api.inceptionlabs.ai/v1/models (2026-06-07).
 *
 * Notes vs the DeepSeek template this is based on:
 * - NO `top_p`: the API advertises only `temperature` and `stop` as supported
 *   sampling parameters, so we don't send top_p.
 * - NO reasoning config: diffusion refinement is internal, there is no
 *   thinking/reasoning channel to extract.
 * - Tools ARE supported (features: tools, json_mode, structured_outputs).
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface MercuryModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  cachedInputCost?: number;
}

export function createMercuryModelConfig(options: MercuryModelOptions): ModelConfig {
  return {
    id: options.id,
    provider: 'mercury',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',
      endpoint: 'https://api.inceptionlabs.ai/v1/chat/completions',
      apiKeyEnvVar: 'INCEPTION_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: true,
      adapter: 'ChatCompletionsAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 128,
      parallelToolCalls: true
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
        default: 4096,
        min: 1,
        max: options.outputTokens
      },
      // Inception advertises only `temperature` + `stop` as supported sampling
      // params, so top_p is marked unsupported (the harness passes through only
      // caller-provided params, so this is metadata, not an injected default).
      topP: {
        supported: false,
        paramName: 'top_p',
        default: 1.0,
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 500,
      tokensPerMinute: 500000
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
        useHelperModel: true
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost,
      ...(options.cachedInputCost !== undefined && { cachedInputPerMillion: options.cachedInputCost })
    }

    // No reasoning: Mercury is a diffusion model — refinement is internal.
  };
}
