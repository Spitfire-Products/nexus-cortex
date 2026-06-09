/**
 * Google Gemini Model Configurator (GenerateContent API)
 *
 * Factory functions for creating Google Gemini model configurations using the GenerateContent API pattern.
 * Handles Gemini 1.5, 2.0, and 2.5 families.
 *
 * Phase 1: Configurator Extraction
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface GeminiModelOptions {
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

export function createGeminiModelConfig(options: GeminiModelOptions): ModelConfig {
  return {
    id: options.id,
    provider: 'google',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'generateContent',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      apiKeyEnvVar: 'GEMINI_API_KEY',
      authHeader: 'x-goog-api-key'
    },

    tools: {
      supported: true,
      adapter: 'GenerateContentAPIAdapter',
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
        percentage: 0.8,
        safetyMargin: 8000
      },
      behavior: {
        preserveRecent: 10,
        compactOlder: true,
        useHelperModel: false
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
