/**
 * Google Gemini Model Configurator (SDK-based - EXPERIMENTAL)
 *
 * Alternative configurator using @google/generative-ai SDK directly instead of REST API.
 * This matches Google's official documentation examples more closely.
 *
 * Key differences from GoogleConfigurator:
 * - Uses 'google-genai' pattern (SDK) instead of 'generateContent' (REST)
 * - May have better performance and stability
 * - Supports both GOOGLE_API_KEY and GEMINI_API_KEY
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface GeminiSDKModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  reasoning?: {
    supported: boolean;
    format?: 'reasoning_content' | 'thinking_block';
    extractionMethod?: 'content_block' | 'separate_field';
    pattern?: 'upfront' | 'interleaved';
  };
}

export function createGeminiSDKModelConfig(options: GeminiSDKModelOptions): ModelConfig {
  return {
    id: options.id,
    provider: 'google',
    displayName: `${options.displayName} (SDK)`,
    family: options.family,

    api: {
      pattern: 'google-sdk',  // New pattern for SDK-based approach
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      // SDK checks both GEMINI_API_KEY and GOOGLE_API_KEY directly in APIClient
      apiKeyEnvVar: 'GEMINI_API_KEY',
      authHeader: 'x-goog-api-key'
    },

    tools: {
      supported: true,
      adapter: 'GenerateContentAPIAdapter',  // Same tool format as REST API
      namingConvention: 'snake_case',
      maxTools: 64,
      parallelToolCalls: true
    },

    parameters: {
      temperature: {
        supported: true,
        paramName: 'temperature',
        min: 0.0,
        max: 2.0,
        path: 'generationConfig.temperature'
      },
      maxTokens: {
        supported: true,
        paramName: 'maxOutputTokens',
        default: 8192,
        min: 1,
        max: options.outputTokens,
        path: 'generationConfig.maxOutputTokens'
      },
      topP: {
        supported: true,
        paramName: 'topP',
        default: 0.95,
        min: 0.0,
        max: 1.0,
        path: 'generationConfig.topP'
      },
      topK: {
        supported: true,
        paramName: 'topK',
        default: 40,
        min: 1,
        max: 100,
        path: 'generationConfig.topK'
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 2000,
      tokensPerMinute: 4000000
    },

    streaming: {
      supported: true,
      format: 'json_stream'
    },

    reasoning: options.reasoning,

    compaction: {
      strategy: 'auto',
      thresholdCalculation: {
        method: 'percentage',
        percentage: 0.75,
        safetyMargin: 8000
      },
      behavior: {
        preserveRecent: 10,
        compactOlder: true,
        useHelperModel: true
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
