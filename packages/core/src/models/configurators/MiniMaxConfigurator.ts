/**
 * MiniMax Model Configurator
 *
 * Factory function for creating MiniMax model configurations.
 * MiniMax uses Anthropic-compatible Messages API pattern.
 *
 * API Docs: https://platform.minimaxi.com/document/Announcement?key=66701cf306509505e38e5fe8
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface MiniMaxModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  supportsTools?: boolean;
  supportsVision?: boolean;

  // Optional overrides
  helperModelId?: string;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
}

/**
 * Create a MiniMax model configuration
 *
 * Generates a complete ModelConfig object for MiniMax models using the Messages API pattern
 * (Anthropic-compatible).
 *
 * @param options - MiniMax model options
 * @returns Complete ModelConfig object
 *
 * @example
 * ```typescript
 * const minimaxM2 = createMiniMaxModelConfig({
 *   id: 'MiniMax-M2',
 *   displayName: 'MiniMax M2',
 *   family: 'minimax-m2',
 *   contextWindow: 1024000,
 *   outputTokens: 8192,
 *   inputCost: 0.42,
 *   outputCost: 1.40
 * });
 * ```
 */
export function createMiniMaxModelConfig(options: MiniMaxModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;

  return {
    id: options.id,
    provider: 'minimax',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'messages',  // Anthropic-compatible Messages API
      endpoint: 'https://api.minimaxi.com/v1/messages',
      apiKeyEnvVar: 'MINIMAX_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: supportsTools,
      adapter: 'MessagesAPIAdapter',  // Same adapter as Claude
      namingConvention: 'snake_case',
      maxTools: supportsTools ? 64 : 0,
      parallelToolCalls: supportsTools
    },

    parameters: {
      temperature: {
        supported: true,
        paramName: 'temperature',
        min: 0.0,
        max: 1.0
      },
      maxTokens: {
        supported: true,
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
      requestsPerMinute: options.requestsPerMinute || 60,
      tokensPerMinute: options.tokensPerMinute || 120000
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
        useHelperModel: false  // Use same model for compaction
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
