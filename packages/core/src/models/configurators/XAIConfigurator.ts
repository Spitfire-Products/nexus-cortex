/**
 * XAI Grok Model Configurator
 *
 * Factory functions for creating XAI Grok model configurations.
 * Supports Messages API (default, preserves interleaved thinking) and Responses API (server-side tools, stateful).
 * Handles Grok 3, Grok 4, and Grok Code families with optional server-side tools support.
 *
 * Phase 1: Configurator Extraction
 */

import type { ModelConfig } from "../ModelConfig.interface.js";
import { DEFAULT_SETTINGS } from "../../config/SettingsSchema.js";

export interface XAIModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  /**
   * Wire model name sent to the xAI API. Defaults to `id`. Set this when the
   * registry id differs from the API model name — e.g. a Responses-transport
   * variant `grok-build-0.1-responses` (registry id) that must send
   * `grok-build-0.1` (wire name). Resolved by GatewayTranslationLayer via the
   * `modelId` field (priority over `id`).
   */
  modelId?: string;
  /**
   * Per-card API transport override. When set, pins this card to a specific
   * wire protocol regardless of the global XAI_API_MODE env var. This lets two
   * cards for the same backend model be registered simultaneously (one
   * 'messages', one 'responses') for head-to-head benchmarking.
   */
  apiMode?: 'messages' | 'responses';
  /** Optional cached-input price per 1M tokens (xAI prompt-cache reads). */
  cachedInputCost?: number;
  /** Whether this model supports reasoning traces */
  supportsReasoning?: boolean;
  /** Whether reasoning can be toggled by user (defaults to same as supportsReasoning) */
  reasoningToggleable?: boolean;
  /**
   * Per-card temperature override. If unset, falls back to family-based default
   * (see `defaultTemperatureForXAIFamily`). Set explicitly when a specific
   * grok variant needs different behavior than its family baseline.
   */
  temperatureDefault?: number;
  /** Opt out of ENABLE_SERVER_SIDE_TOOLS override (defaults true). */
  supportsServerSideTools?: boolean;
  /** Default reasoning effort for Responses API (grok-4 doesn't support it, grok-4.3 does). */
  reasoningEffort?: 'low' | 'medium' | 'high';
}


export function createXAIModelConfig(options: XAIModelOptions): ModelConfig {
  // Per-card apiMode pins the transport (for head-to-head benchmarking).
  // Otherwise XAI_API_MODE loaded from .env via dotenv; default from SettingsSchema.
  // ENABLE_SERVER_SIDE_TOOLS dynamically overrides to 'responses' at request time via ServerSideToolDetection
  const apiMode = options.apiMode || process.env.XAI_API_MODE || DEFAULT_SETTINGS.XAI_API_MODE;
  const useResponsesAPI = apiMode === 'responses';

  // Temperature default: ONLY an explicit per-card override. Otherwise left
  // undefined so no temperature is sent and xAI applies its own default
  // (minimal-blast: per-model values are added deliberately as they're
  // benchmarked, e.g. grok-4.3 → 0.5).
  const temperatureDefault = options.temperatureDefault;

  return {
    id: options.id,
    ...(options.modelId && { modelId: options.modelId }),
    provider: "xai",
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: useResponsesAPI ? "responses" : "messages",
      endpoint: useResponsesAPI ? "https://api.x.ai/v1/responses" : "https://api.x.ai/v1/messages",
      apiKeyEnvVar: "XAI_API_KEY",
      authHeader: useResponsesAPI ? "authorization" : "x-api-key",
      authPrefix: useResponsesAPI ? "Bearer " : "",
    },

    tools: {
      supported: true,
      adapter: useResponsesAPI ? "ResponsesAPIAdapter" : "MessagesAPIAdapter",
      namingConvention: "snake_case",
      maxTools: 128,
      parallelToolCalls: true,
    },

    ...(options.supportsServerSideTools !== false && {
      serverSideTools: {
        supported: true,
        supportedEndpoints: ["responses"],
        availableTools: [
          "web_search",
          "web_search_with_snippets",
          "browse_page",
          "x_search",
          "x_user_search",
          "x_keyword_search",
          "x_semantic_search",
          "x_thread_fetch",
          "code_execution",
          "view_image",
          "view_x_video",
        ],
        metadata: {
          supportsCitations: true,
          supportsToolUsage: true,
          supportsReasoningTokens: true,
        },
      },
    }),

    parameters: {
      temperature: {
        supported: true,
        paramName: "temperature",
        default: temperatureDefault,
        min: 0.0,
        max: 2.0,
      },
      maxTokens: {
        supported: true,
        paramName: useResponsesAPI ? "max_output_tokens" : "max_tokens",
        default: 4096,
        min: 1,
        max: options.outputTokens,
      },
      topP: {
        supported: true,
        paramName: "top_p",
        default: 1.0,
        min: 0.0,
        max: 1.0,
      },
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 60,
      tokensPerMinute: 2000000,
    },

    streaming: {
      supported: true,
      format: "sse",
    },

    // Add reasoning configuration if supported
    ...(options.supportsReasoning && {
      reasoning: {
        supported: true,
        format: "reasoning_content",
        extractionMethod: "separate_field",
        pattern: "interleaved",
        toggleable: options.reasoningToggleable ?? options.supportsReasoning,
        ...(options.reasoningEffort && { defaultEffort: options.reasoningEffort }),
      },
    }),

    compaction: {
      strategy: "auto",
      thresholdCalculation: {
        method: "percentage",
        percentage: 0.8,
        safetyMargin: 4000,
      },
      behavior: {
        preserveRecent: 10,
        compactOlder: true,
        useHelperModel: false,
      },
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost,
      ...(options.cachedInputCost !== undefined && { cachedInputPerMillion: options.cachedInputCost }),
    },
  };
}
