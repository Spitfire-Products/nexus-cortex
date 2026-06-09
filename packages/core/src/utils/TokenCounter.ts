/**
 * Token Counter Utility
 *
 * Provides accurate token counting for different AI providers using their
 * respective tokenizers. Falls back to estimation when provider-specific
 * tokenizer is not available.
 *
 * Phase 1.5 Enhancement: Priority 1.1
 * Based on: WEEK_3_COMPLETION_HANDOFF.md Lines 479-523
 */

import { encoding_for_model, Tiktoken, TiktokenModel } from 'tiktoken';
import { countTokens as anthropicCountTokens } from '@anthropic-ai/tokenizer';
import type { ModelConfig } from '../models/ModelConfig.interface.js';

/**
 * Token counting result with metadata
 */
export interface TokenCountResult {
  /** Number of tokens counted */
  tokens: number;

  /** Method used for counting */
  method: 'tiktoken' | 'anthropic' | 'estimation';

  /** Model ID used for counting */
  modelId: string;

  /** Provider name */
  provider: string;
}

/**
 * Token Counter class with provider-specific tokenizers
 */
export class TokenCounter {
  private static tiktokenCache: Map<string, Tiktoken> = new Map();

  /**
   * Count tokens in content using provider-specific tokenizer
   *
   * @param content - Content to count tokens for (string, object, or array)
   * @param modelConfig - Model configuration for provider detection
   * @returns Token count result with metadata
   */
  static count(content: any, modelConfig: ModelConfig): TokenCountResult {
    const contentString = typeof content === 'string'
      ? content
      : JSON.stringify(content);

    const provider = modelConfig.provider.toLowerCase();
    const modelId = modelConfig.id;

    // OpenAI and OpenAI-compatible models (tiktoken)
    if (provider === 'openai' || modelId.startsWith('gpt-')) {
      return this.countWithTiktoken(contentString, modelId, provider);
    }

    // Anthropic models (official tokenizer)
    if (provider === 'anthropic' || modelId.startsWith('claude-')) {
      return this.countWithAnthropic(contentString, modelId, provider);
    }

    // Google models (estimation - no official tokenizer in npm)
    if (provider === 'google' || modelId.startsWith('gemini-')) {
      return this.countWithEstimation(contentString, modelId, provider);
    }

    // Other providers (estimation)
    return this.countWithEstimation(contentString, modelId, provider);
  }

  /**
   * Count tokens using tiktoken (OpenAI tokenizer)
   */
  private static countWithTiktoken(
    content: string,
    modelId: string,
    provider: string
  ): TokenCountResult {
    try {
      // Map model ID to tiktoken model name
      const tiktokenModel = this.getTiktokenModel(modelId);

      // Get or create cached encoder
      let encoder = this.tiktokenCache.get(tiktokenModel);
      if (!encoder) {
        encoder = encoding_for_model(tiktokenModel);
        this.tiktokenCache.set(tiktokenModel, encoder);
      }

      const tokens = encoder.encode(content).length;

      return {
        tokens,
        method: 'tiktoken',
        modelId,
        provider,
      };
    } catch (error) {
      // Fall back to estimation if tiktoken fails
      console.warn(`Tiktoken failed for ${modelId}, falling back to estimation:`, error);
      return this.countWithEstimation(content, modelId, provider);
    }
  }

  /**
   * Count tokens using Anthropic's tokenizer
   */
  private static countWithAnthropic(
    content: string,
    modelId: string,
    provider: string
  ): TokenCountResult {
    try {
      const tokens = anthropicCountTokens(content);

      return {
        tokens,
        method: 'anthropic',
        modelId,
        provider,
      };
    } catch (error) {
      // Fall back to estimation if Anthropic tokenizer fails
      console.warn(`Anthropic tokenizer failed for ${modelId}, falling back to estimation:`, error);
      return this.countWithEstimation(content, modelId, provider);
    }
  }

  /**
   * Count tokens using estimation (4 chars per token)
   */
  private static countWithEstimation(
    content: string,
    modelId: string,
    provider: string
  ): TokenCountResult {
    // Standard estimation: ~4 characters per token
    const tokens = Math.ceil(content.length / 4);

    return {
      tokens,
      method: 'estimation',
      modelId,
      provider,
    };
  }

  /**
   * Map model ID to tiktoken model name
   */
  private static getTiktokenModel(modelId: string): TiktokenModel {
    // GPT-4 and GPT-4 Turbo models
    if (modelId.includes('gpt-4-turbo') || modelId.includes('gpt-4-1106')) {
      return 'gpt-4-turbo-preview';
    }
    if (modelId.includes('gpt-4-32k')) {
      return 'gpt-4-32k';
    }
    if (modelId.includes('gpt-4')) {
      return 'gpt-4';
    }

    // GPT-3.5 models
    if (modelId.includes('gpt-3.5-turbo-16k')) {
      return 'gpt-3.5-turbo-16k';
    }
    if (modelId.includes('gpt-3.5-turbo')) {
      return 'gpt-3.5-turbo';
    }

    // Default to gpt-3.5-turbo for unknown models
    return 'gpt-3.5-turbo';
  }

  /**
   * Batch count tokens for multiple contents
   *
   * @param contents - Array of contents to count
   * @param modelConfig - Model configuration
   * @returns Array of token count results
   */
  static countBatch(
    contents: any[],
    modelConfig: ModelConfig
  ): TokenCountResult[] {
    return contents.map(content => this.count(content, modelConfig));
  }

  /**
   * Count total tokens for an array of contents
   *
   * @param contents - Array of contents to count
   * @param modelConfig - Model configuration
   * @returns Total token count
   */
  static countTotal(contents: any[], modelConfig: ModelConfig): number {
    return contents.reduce((total, content) => {
      return total + this.count(content, modelConfig).tokens;
    }, 0);
  }

  /**
   * Clean up cached encoders (call when no longer needed)
   */
  static cleanup(): void {
    // Free tiktoken encoders
    for (const encoder of this.tiktokenCache.values()) {
      encoder.free();
    }
    this.tiktokenCache.clear();
  }

  /**
   * Get statistics about token counting methods used
   */
  static getStats(): {
    cacheSize: number;
    cachedModels: string[];
  } {
    return {
      cacheSize: this.tiktokenCache.size,
      cachedModels: Array.from(this.tiktokenCache.keys()),
    };
  }
}

/**
 * Helper function for quick token counting
 *
 * @param content - Content to count tokens for
 * @param modelConfig - Model configuration
 * @returns Token count
 */
export function countTokens(content: any, modelConfig: ModelConfig): number {
  return TokenCounter.count(content, modelConfig).tokens;
}

/**
 * Helper function to estimate tokens (fallback when config not available)
 *
 * @param content - Content to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(content: any): number {
  const contentString = typeof content === 'string'
    ? content
    : JSON.stringify(content);
  return Math.ceil(contentString.length / 4);
}
