/**
 * Google Gemma Model Configurator (FREE - GoogleGenAI API)
 *
 * Factory functions for creating FREE Google Gemma model configurations using the GoogleGenAI API pattern.
 * These models use the @google/genai package instead of @google/generative-ai.
 *
 * Phase 1: Configurator Extraction
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface GemmaModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
}

export function createGemmaModelConfig(options: GemmaModelOptions): ModelConfig {
  return {
    id: options.id,
    provider: 'google',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'google-genai',  // Different pattern for FREE Gemma models
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      apiKeyEnvVar: 'GEMINI_API_KEY',
      authHeader: 'x-goog-api-key'
    },

    tools: {
      supported: true,  // Gemma 3 27B and 12B support function calling
      adapter: 'GoogleGenAPIAdapter',  // Uses @google/genai, not @google/generative-ai
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
      supported: false  // Basic @google/genai doesn't support streaming
    },

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
      inputPerMillion: 0.0,   // 100% FREE models
      outputPerMillion: 0.0   // Zero cost
    }
  };
}
