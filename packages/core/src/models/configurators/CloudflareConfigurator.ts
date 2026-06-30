/**
 * Cloudflare Workers AI Model Configurator
 *
 * Factory function for creating Cloudflare Workers AI model configurations.
 *
 * Cloudflare Workers AI exposes an OpenAI-compatible Chat Completions endpoint:
 *   POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions
 *
 * Auth is `Authorization: Bearer ${CLOUDFLARE_API_TOKEN}`.
 *
 * The wire format is OpenAI Chat Completions — we reuse ChatCompletionsAPIAdapter
 * unchanged. CF model IDs use the `@cf/<vendor>/<model>` namespacing convention
 * and are passed verbatim in the `model` field of the request body.
 *
 * Endpoint construction reads `CLOUDFLARE_ACCOUNT_ID` from the environment at
 * module load. If unset, the endpoint URL contains an empty account segment and
 * the first request will 404 — which is the correct failure mode (clear error,
 * scoped to when someone actually selects a CF model).
 *
 * Pricing: Workers AI is Neurons-based, not per-token. The inputCost / outputCost
 * fields on each card are coarse placeholders for the cost-display layer; refer to
 * the CF dashboard for accurate consumption metrics.
 *
 * Workers AI catalog: https://developers.cloudflare.com/workers-ai/models/
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface CloudflareModelOptions {
  /** Full CF model id including @cf/ prefix, e.g. '@cf/meta/llama-3.3-70b-instruct-fp8-fast'. */
  id: string;
  displayName: string;
  /** Family for grouping in UI (e.g. 'llama', 'qwen', 'mistral'). */
  family: string;
  contextWindow: number;
  outputTokens: number;
  /** Placeholder per-million cost — CF actual billing is Neurons-based. */
  inputCost: number;
  outputCost: number;
  /** Cloudflare discounts automatic prefix-cached input tokens (per-model). $/M. */
  cachedInputCost?: number;
  /** Some CF models expose visible reasoning (e.g. gpt-oss, qwq, kimi). */
  supportsReasoning?: boolean;
  /** Vision-capable models (mistral-small, gemma, kimi, llama-4-scout). */
  supportsVision?: boolean;
  /** Whether the model has been verified to support native tool calling on CF Workers AI. */
  supportsTools?: boolean;
}

export function createCloudflareModelConfig(options: CloudflareModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';

  return {
    id: options.id,
    provider: 'cloudflare',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',
      // Empty accountId yields a malformed URL; first request 404s with a clear
      // signal when CLOUDFLARE_ACCOUNT_ID isn't set. Intentional fail-fast.
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
      apiKeyEnvVar: 'CLOUDFLARE_API_TOKEN',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: supportsTools,
      adapter: 'ChatCompletionsAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: supportsTools ? 64 : 0,
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
        // CF Workers AI uses standard OpenAI max_tokens — not max_completion_tokens.
        paramName: 'max_tokens',
        default: 4096,
        min: 1,
        max: options.outputTokens
      },
      topP: {
        supported: true,
        paramName: 'top_p',
        default: 1.0,
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      // CF Workers AI rate limits vary per model and account tier; these are
      // conservative defaults. Real per-account caps are visible in the CF dash.
      requestsPerMinute: 300,
      tokensPerMinute: 100000
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
        useHelperModel: false,
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost,
      ...(options.cachedInputCost !== undefined && { cachedInputPerMillion: options.cachedInputCost })
    },

    ...(options.supportsReasoning && {
      reasoning: {
        supported: true,
        format: 'reasoning_content',
        extractionMethod: 'separate_field',
        pattern: 'upfront'
      }
    })
  };
}
