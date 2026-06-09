/**
 * Google Gen API Helper Adapter
 * Phase 1.5: Week 2 - Independent Helper Middleware
 *
 * Handles helper model communication using Google's 'google-genai' API pattern.
 * Self-contained implementation for FREE Gemma 3 model access.
 *
 * API Pattern: 'google-genai' (@google/genai package)
 * - Different from 'generateContent' pattern (which uses @google/generative-ai)
 * - Simplified API for FREE Gemma models only
 *
 * ARCHITECTURE:
 * - Self-contained: No external service dependencies
 * - All Gemma-specific logic inlined (chunking, fallback, etc.)
 * - Supports FREE Gemma models (gemma-3-27b-it, gemma-3-12b-it, etc.)
 * - Handles 128K+ content via hierarchical chunking
 * - $0 cost for all operations (100% cost savings)
 */

import { GoogleGenAI } from '@google/genai';
import {
  BaseHelperAdapter,
  type HelperCanonicalMessage,
  type CompactionResult,
  type ToolSummaryResult
} from '../HelperMiddlewareAdapter.interface.js';
import type { ModelConfig } from '../../../models/ModelConfig.interface.js';

/**
 * Gemma compaction response (internal)
 */
interface GemmaCompactionResponse {
  summary: string;
  model: string;
  processingTime: number;
  inputTokens: number;
  outputTokens: number;
  cost: number; // Always $0
}

/**
 * Helper adapter for Google Gen API pattern ('google-genai')
 *
 * Uses @google/genai package for FREE Gemma models.
 * Different from GenerateContentAPIHelperAdapter which uses @google/generative-ai.
 *
 * Supports: FREE Gemma 3 models via Google GenAI API
 * - gemma-3-27b-it: High quality (27B params)
 * - gemma-3-12b-it: Balanced (12B params)
 * - gemma-3-4b-it: Fast (4B params)
 * - gemma-3-1b-it: Ultra-fast (1B params)
 *
 * CRITICAL: All Gemma models are FREE ($0 cost)
 */
export class GoogleGenAPIHelperAdapter extends BaseHelperAdapter {
  readonly apiPattern = 'google-genai';
  readonly name = 'GoogleGenAPIHelperAdapter';

  private defaultModel = 'gemma-3-27b-it';
  private fallbackModel = 'gemma-3-12b-it';

  /**
   * Compact conversation history via FREE Gemma models
   *
   * Automatically:
   * - Chunks content > 128K tokens
   * - Falls back between models if one unavailable
   * - Returns $0 cost (100% free)
   */
  async compact(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    targetTokens: number
  ): Promise<CompactionResult> {
    const startTime = Date.now();

    // Estimate original tokens
    const originalText = this.extractTextContent(messages);
    const originalTokens = this.estimateTokens(originalText);

    // Compact content using Gemma
    const response = await this.compactContent(
      originalText,
      helperConfig,
      targetTokens
    );

    // Extract summary and calculate savings
    const summary = response.summary;
    const compressedTokens = response.outputTokens;
    const tokensSaved = originalTokens - compressedTokens;

    // Create compacted messages (summary + keep most recent messages)
    const recentCount = Math.min(5, messages.length);
    const recentMessages = messages.slice(-recentCount);
    const compactedMessages: HelperCanonicalMessage[] = [
      {
        role: 'system',
        content: `[Compacted History]\n${summary}`
      },
      ...recentMessages
    ];

    const processingTime = Date.now() - startTime;

    return {
      summary,
      compactedMessages,
      originalTokens,
      compressedTokens,
      tokensSaved,
      helperModelId: response.model, // Actual model used (may differ if fallback occurred)
      processingTime,
      cost: 0 // Gemma models are FREE!
    };
  }

  /**
   * Summarize tool result via FREE Gemma models
   */
  async summarizeToolResult(
    toolResult: string,
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<ToolSummaryResult> {
    const startTime = Date.now();

    // Estimate original tokens
    const originalTokens = this.estimateTokens(toolResult);

    // Create summarization prompt
    const prompt = `Summarize the following tool result in ${maxTokens} tokens or less, preserving essential information:\n\n${toolResult}`;

    // Compact via Gemma
    const response = await this.compactContent(
      prompt,
      helperConfig,
      maxTokens
    );

    // Extract summary
    const summary = response.summary;
    const summaryTokens = response.outputTokens;
    const tokensSaved = originalTokens - summaryTokens;

    const processingTime = Date.now() - startTime;

    return {
      summary,
      originalTokens,
      summaryTokens,
      tokensSaved,
      helperModelId: response.model,
      processingTime,
      cost: 0 // Gemma models are FREE!
    };
  }

  /**
   * Compact content using free Gemma models
   * Automatically handles content based on model's context limit (dynamic chunking)
   */
  private async compactContent(
    content: string,
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<GemmaCompactionResponse> {
    const modelToUse = helperConfig.id || this.defaultModel;
    const startTime = Date.now();

    // Check if content needs chunking (uses model's actual context window)
    if (this.needsChunking(content, helperConfig, maxTokens)) {
      const contentTokens = this.estimateTokens(content);
      const contextInfo = this.getContextInfo(helperConfig);
      console.log(` ⚠  Content too large (${contentTokens} tokens) for ${contextInfo}, using smart chunking...`);
      return await this.compactLargeContent(
        content,
        helperConfig,
        modelToUse,
        maxTokens,
        startTime
      );
    }

    // Get API client
    const client = this.getClient(helperConfig);

    try {
      // Try primary model
      const response = await this.tryModel(client, modelToUse, content, maxTokens);
      return this.formatResponse(response, modelToUse, startTime, content);
    } catch (error: any) {
      // If model not found, try fallback
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        console.log(` Gemma model ${modelToUse} not available, trying ${this.fallbackModel}...`);
        const response = await this.tryModel(client, this.fallbackModel, content, maxTokens);
        return this.formatResponse(response, this.fallbackModel, startTime, content);
      }
      throw error;
    }
  }

  /**
   * Try generating content with a specific model
   */
  private async tryModel(
    client: GoogleGenAI,
    model: string,
    content: string,
    maxTokens: number
  ): Promise<string> {
    const response = await client.models.generateContent({
      model,
      contents: `Summarize the following conversation history in ${maxTokens} tokens or less, preserving key topics and decisions:\n\n${content}`,
    });

    return response.text || '';
  }

  /**
   * Format response with token estimates
   */
  private formatResponse(
    summary: string,
    model: string,
    startTime: number,
    originalContent: string
  ): GemmaCompactionResponse {
    const processingTime = Date.now() - startTime;

    // Estimate tokens (4 chars per token heuristic)
    const inputTokens = Math.floor(originalContent.length / 4);
    const outputTokens = Math.floor(summary.length / 4);

    return {
      summary,
      model,
      processingTime,
      inputTokens,
      outputTokens,
      cost: 0, // Gemma models are FREE!
    };
  }

  /**
   * Handle large content via chunking strategy
   * Split content into chunks, compress each, then combine
   * Uses smart chunking from base adapter (adapts to model's context limit)
   */
  private async compactLargeContent(
    content: string,
    helperConfig: ModelConfig,
    model: string,
    maxTokens: number,
    startTime: number
  ): Promise<GemmaCompactionResponse> {
    // Use base class smart chunking (dynamically calculates based on model config)
    const chunks = this.chunkContent(content, helperConfig, maxTokens);
    const chunkSummaries: string[] = [];
    const client = this.getClient(helperConfig);

    console.log(` Processing ${chunks.length} chunks (smart chunking for ${this.getContextInfo(helperConfig)})...`);

    // Compress each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      console.log(` ⏳ Chunk ${i + 1}/${chunks.length} (${this.estimateTokens(chunk)} tokens)...`);

      try {
        const chunkSummary = await this.tryModel(
          client,
          model,
          chunk,
          Math.floor(maxTokens / chunks.length) // Distribute token budget
        );
        chunkSummaries.push(chunkSummary);
      } catch (error: any) {
        console.warn(` ⚠  Chunk ${i + 1} failed: ${error.message}`);
        // Include error marker in summary
        chunkSummaries.push(`[Chunk ${i + 1} compression failed]`);
      }
    }

    // Combine chunk summaries
    const combinedSummary = chunkSummaries.join('\n\n---\n\n');

    // If combined is still too large, do one final pass
    const combinedTokens = this.estimateTokens(combinedSummary);
    if (combinedTokens > maxTokens) {
      console.log(` Final compression pass (${combinedTokens} → ${maxTokens} tokens)...`);
      const finalSummary = await this.tryModel(
        client,
        model,
        `Combine and summarize these section summaries into ${maxTokens} tokens:\n\n${combinedSummary}`,
        maxTokens
      );
      return this.formatResponse(finalSummary, model, startTime, content);
    }

    return this.formatResponse(combinedSummary, model, startTime, content);
  }

  /**
   * Get Google GenAI client
   */
  private getClient(config: ModelConfig): GoogleGenAI {
    // Get API key from environment
    const apiKey = process.env[config.api.apiKeyEnvVar];

    if (!apiKey) {
      throw new Error(
        `GoogleGenAPIHelper: API key not found in environment variable: ${config.api.apiKeyEnvVar}`
      );
    }

    return new GoogleGenAI({ apiKey });
  }

  /**
   * Override estimateTokens to use consistent heuristic
   */
  public estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  /**
   * Override calculateCost to always return $0 for Gemma models
   */
  protected calculateCost(
    _inputTokens: number,
    _outputTokens: number,
    _modelConfig: ModelConfig
  ): number {
    return 0; // Gemma models are 100% FREE
  }

  /**
   * Get list of supported Gemma models (via Google GenAI API)
   */
  static getSupportedModels(): string[] {
    return [
      'gemma-3-27b-it',  // High quality (27B params)
      'gemma-3-12b-it',  // Balanced (12B params)
      'gemma-3-4b-it',   // Fast (4B params)
      'gemma-3-1b-it',   // Ultra-fast (1B params)
      'gemma-3n-e4b-it', // Efficient 4B variant
      'gemma-3n-e2b-it', // Efficient 2B variant
    ];
  }
}

/**
 * Pricing information for documentation
 */
export const GEMMA_PRICING = {
  'gemma-3-27b-it': {
    input: 0, // FREE
    output: 0, // FREE
    description: 'High-quality free model for summarization (27B params)',
  },
  'gemma-3-12b-it': {
    input: 0, // FREE
    output: 0, // FREE
    description: 'Balanced quality/speed free model (12B params)',
  },
  'gemma-3-4b-it': {
    input: 0, // FREE
    output: 0, // FREE
    description: 'Fast free model for quick compaction (4B params)',
  },
  'gemma-3-1b-it': {
    input: 0, // FREE
    output: 0, // FREE
    description: 'Ultra-fast free model for rapid compaction (1B params)',
  },
  'gemma-3n-e4b-it': {
    input: 0, // FREE
    output: 0, // FREE
    description: 'Efficient 4B variant optimized for speed',
  },
  'gemma-3n-e2b-it': {
    input: 0, // FREE
    output: 0, // FREE
    description: 'Efficient 2B variant ultra-fast',
  },
} as const;
