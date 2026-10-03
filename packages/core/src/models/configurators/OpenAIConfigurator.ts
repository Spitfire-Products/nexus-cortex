/**
 * OpenAI Model Configurator (Chat Completions API + dynamic Responses switch)
 *
 * Factory functions for creating OpenAI model configurations. Default transport
 * is Chat Completions; cards may opt into Responses-API-by-default via the
 * OPENAI_API_MODE env var (when set to 'responses' AND the card declares
 * `supportsServerSideTools: true`).
 *
 * Regardless of static config, when ENABLE_SERVER_SIDE_TOOLS=true and a
 * request contains a server-side tool, ServerSideToolDetection switches the
 * specific call to /v1/responses (R20 — grok-4.1-fast pattern parity).
 *
 * Phase 1: Configurator Extraction; R20 (2026-05-13): Responses opt-in.
 */

import type { ModelConfig } from '../ModelConfig.interface.js';
import { DEFAULT_SETTINGS } from '../../config/SettingsSchema.js';

export interface OpenAIModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  supportsTools?: boolean;
  /**
   * Parameter name for max tokens in API requests.
   * - 'max_tokens' for older models (GPT-4, GPT-4o)
   * - 'max_completion_tokens' for newer models (GPT-5 family)
   * Defaults to 'max_tokens' for backwards compatibility.
   */
  maxTokensParamName?: 'max_tokens' | 'max_completion_tokens';
  reasoning?: {
    supported: boolean;
    format?: 'reasoning_content' | 'thinking_block' | 'reasoning_item';
    extractionMethod?: 'content_block' | 'separate_field' | 'output_item';
    pattern?: 'upfront' | 'interleaved';
  };
  /**
   * R20: Card-level opt-in to declare this model supports OpenAI's hosted
   * server-side tools (web_search, code_interpreter, file_search,
   * image_generation, mcp) via the Responses API. When set:
   * - `serverSideTools` config is populated on the ModelConfig.
   * - With ENABLE_SERVER_SIDE_TOOLS=true and a server-side tool in the
   *   request, ServerSideToolDetection dynamically routes to /v1/responses.
   * - With OPENAI_API_MODE=responses, the model's default transport becomes
   *   Responses even without server-side tools in the request.
   * Recommended for the GPT-5 family.
   */
  supportsServerSideTools?: boolean;
  /** Cached-input price per 1M tokens (cost.cachedInputPerMillion; gateway cache metrics prefer it over the 50% default). */
  cachedInputCost?: number;
  /**
   * false = the model rejects sampling params on the Responses API ("Unsupported parameter: 'top_p' is not
   * supported with this model" — gpt-5.6-sol, live 2026-10-03). Marks temperature + topP unsupported and
   * drops the topP default (1.0). Omit = legacy behavior. (chat/completions already strips top_p when
   * reasoning is on.)
   */
  samplingParams?: boolean;
  /** Narrow-door lift architecture (same fields + semantics as DeepSeekModelOptions; env levers override).
   *  anchorProfile: home-door first-turn anchor profile. promptPreset: card prompt-composition preset.
   *  liftNudge: lift-boundary SearchTools/AskForAdvice signpost. headlessDropAskUser: drop AskUserQuestion headless. */
  anchorProfile?: 'lean' | 'bash-only' | 'bash-plus' | 'bash-edit';
  promptPreset?: 'boot-minimal';
  liftNudge?: boolean;
  headlessDropAskUser?: boolean;
  /** Pin the card to /v1/responses regardless of OPENAI_API_MODE (2026-10-03). For reasoning models whose function
   *  tools 400 on chat/completions unless reasoning_effort is 'none' (live: gpt-5.4-nano, gpt-5.6-*, gpt-6-*), so the
   *  library routes them correctly by default and no surface needs an env lever. Implies supportsServerSideTools. */
  responsesOnly?: boolean;
}

export function createOpenAIModelConfig(options: OpenAIModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;
  // Default to 'max_tokens' for backwards compatibility with older models
  const maxTokensParamName = options.maxTokensParamName || 'max_tokens';

  // R20: OPENAI_API_MODE env can globally promote opt-in cards to use the
  // Responses API as their default transport. Cards must opt in via
  // `supportsServerSideTools: true` to be eligible — otherwise the env flag
  // is a no-op (e.g. older GPT-4o cards stay on chat/completions).
  const apiMode = process.env.OPENAI_API_MODE || DEFAULT_SETTINGS.OPENAI_API_MODE;
  const useResponsesAPI = options.responsesOnly === true
    || (options.supportsServerSideTools === true && apiMode === 'responses');

  return {
    ...(options.anchorProfile ? { anchorProfile: options.anchorProfile } : {}),
    ...(options.promptPreset ? { promptPreset: options.promptPreset } : {}),
    ...(options.liftNudge !== undefined ? { liftNudge: options.liftNudge } : {}),
    ...(options.headlessDropAskUser !== undefined ? { headlessDropAskUser: options.headlessDropAskUser } : {}),
    id: options.id,
    provider: 'openai',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: useResponsesAPI ? 'responses' : 'chat/completions',
      endpoint: useResponsesAPI
        ? 'https://api.openai.com/v1/responses'
        : 'https://api.openai.com/v1/chat/completions',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: supportsTools,
      // R20: adapter follows the transport. ServerSideToolDetection swaps the
      // adapter at request time when it dynamically switches endpoints.
      adapter: useResponsesAPI ? 'ResponsesAPIAdapter' : 'ChatCompletionsAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: supportsTools ? 128 : 0,
      parallelToolCalls: supportsTools
    },

    // R20: declare server-side tool support so ServerSideToolDetection can
    // route to /v1/responses dynamically when ENABLE_SERVER_SIDE_TOOLS=true
    // and a hosted tool is present in the request.
    ...((options.supportsServerSideTools || options.responsesOnly) && {
      serverSideTools: {
        supported: true,
        supportedEndpoints: ['responses'],
        availableTools: [
          'web_search',
          'web_search_preview',
          'code_interpreter',
          'file_search',
          'image_generation',
          'computer_use_preview',
          'mcp',
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
        supported: options.samplingParams !== false,
        paramName: 'temperature',
        min: 0.0,
        max: 2.0
      },
      maxTokens: {
        supported: true,
        // R20: Responses API uses max_output_tokens, not max_completion_tokens.
        // When this card's static default is Responses, switch the param name.
        // Dynamic switches (per-call) are handled by GatewayTranslationLayer.
        paramName: useResponsesAPI ? 'max_output_tokens' : maxTokensParamName,
        default: 4096,
        min: 1,
        max: options.outputTokens
      },
      topP: {
        supported: options.samplingParams !== false,
        paramName: 'top_p',
        ...(options.samplingParams !== false && { default: 1.0 }),
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 500,
      tokensPerMinute: 150000
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
        useHelperModel: supportsTools,
        helperModelId: supportsTools ? 'gpt-4o-mini' : undefined
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost,
      ...(options.cachedInputCost !== undefined && { cachedInputPerMillion: options.cachedInputCost })
    },

    reasoning: options.reasoning
  };
}
