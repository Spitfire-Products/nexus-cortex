/**
 * Anthropic Model Configurator
 *
 * Factory functions for creating Anthropic Claude model configurations.
 * Handles Claude Sonnet, Opus, and Haiku families with Messages API pattern.
 *
 * Phase 1: Configurator Extraction
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

/**
 * Options for creating a Claude model configuration
 */
export interface ClaudeModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;

  // Optional overrides
  helperModelId?: string;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  reasoning?: {
    supported: boolean;
    format?: 'reasoning_content' | 'thinking_block';
    extractionMethod?: 'content_block' | 'separate_field';
    pattern?: 'upfront' | 'interleaved';
    toggleable?: boolean;
  };
  /** Model supports Anthropic Programmatic Tool Calling (PTC). */
  supportsPTC?: boolean;
}

/**
 * Create a Claude model configuration
 *
 * Generates a complete ModelConfig object for Anthropic Claude models using the Messages API pattern.
 * Provides sensible defaults for API configuration, tool support, parameters, and compaction strategy.
 *
 * @param options - Claude model options
 * @returns Complete ModelConfig object
 *
 * @example
 * ```typescript
 * const claudeSonnet = createClaudeModelConfig({
 *   id: 'claude-sonnet-4-5-20250929',
 *   displayName: 'Claude 4.5 Sonnet',
 *   family: 'claude-4.5',
 *   contextWindow: 200000,
 *   outputTokens: 8192,
 *   inputCost: 3.0,
 *   outputCost: 15.0
 * });
 * ```
 */
export function createClaudeModelConfig(options: ClaudeModelOptions): ModelConfig {
  return {
    id: options.id,
    provider: 'anthropic',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'messages',
      endpoint: 'https://api.anthropic.com/v1/messages',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      authHeader: 'x-api-key',
      versionHeader: {
        name: 'anthropic-version',
        value: '2023-06-01'
      }
    },

    tools: {
      supported: true,
      adapter: 'MessagesAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 64,
      parallelToolCalls: true
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
        default: 8192,
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
      requestsPerMinute: options.requestsPerMinute || 50,
      tokensPerMinute: options.tokensPerMinute || 40000
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
        useHelperModel: true,
        helperModelId: options.helperModelId || 'claude-haiku-4-5'
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    },

    reasoning: options.reasoning,
    supportsPTC: options.supportsPTC
  };
}
