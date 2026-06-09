/**
 * GenerateContent API Helper Adapter
 * Phase 1.5: Week 2 - Independent Helper Middleware
 *
 * Handles helper model communication using Google's generateContent API pattern.
 * Used for paid Gemini models (Pro, Flash, etc.) via @google/generative-ai SDK.
 *
 * API Pattern: 'generateContent' (@google/generative-ai package)
 * - Different from 'google-genai' pattern (which uses @google/genai for FREE Gemma models)
 * - Full-featured API with tools/functions, streaming, etc.
 * - Used for production Gemini models
 *
 * ARCHITECTURE:
 * - Self-contained: No dependency on main adapter system
 * - Makes real API calls using @google/generative-ai SDK
 * - Supports Gemini Pro, Gemini Flash, and other paid Gemini models
 * - Handles large context windows (up to 2M tokens for some models)
 */

import {
  BaseHelperAdapter,
  type HelperCanonicalMessage,
  type CompactionResult,
  type ToolSummaryResult
} from '../HelperMiddlewareAdapter.interface.js';
import type { ModelConfig } from '../../../models/ModelConfig.interface.js';

/**
 * Helper adapter for GenerateContent API pattern ('generateContent')
 *
 * Uses @google/generative-ai package for paid Gemini models.
 *
 * Supports: Gemini Pro, Gemini Flash, Gemini Ultra (when available)
 * - gemini-2.0-flash-lite: Fast, cost-effective ($0.075/1M tokens)
 * - gemini-1.5-pro: High-quality reasoning ($3.50/1M tokens)
 * - gemini-1.5-flash: Balanced performance ($0.375/1M tokens)
 */
export class GenerateContentAPIHelperAdapter extends BaseHelperAdapter {
  readonly apiPattern = 'generateContent';
  readonly name = 'GenerateContentAPIHelperAdapter';

  /**
   * Compact conversation history via paid Gemini models
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

    // Create compaction prompt
    const prompt = this.createCompactionPrompt(messages, targetTokens);

    // Make real API call via Google Generative AI SDK
    const response = await this.makeAPICall(helperConfig, prompt, targetTokens);

    // Extract summary from response
    const summary = response.text;
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
    const cost = this.calculateCost(
      response.inputTokens,
      response.outputTokens,
      helperConfig
    );

    return {
      summary,
      compactedMessages,
      originalTokens,
      compressedTokens,
      tokensSaved,
      helperModelId: helperConfig.id,
      processingTime,
      cost
    };
  }

  /**
   * Summarize tool result via paid Gemini models
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
    const prompt = this.createToolSummaryPrompt(toolResult, maxTokens);

    // Make real API call via Google Generative AI SDK
    const response = await this.makeAPICall(helperConfig, prompt, maxTokens);

    // Extract summary
    const summary = response.text;
    const summaryTokens = response.outputTokens;
    const tokensSaved = originalTokens - summaryTokens;

    const processingTime = Date.now() - startTime;
    const cost = this.calculateCost(
      response.inputTokens,
      response.outputTokens,
      helperConfig
    );

    return {
      summary,
      originalTokens,
      summaryTokens,
      tokensSaved,
      helperModelId: helperConfig.id,
      processingTime,
      cost
    };
  }

  /**
   * Make real API call to Google Generative AI
   *
   * CRITICAL: This makes REAL API calls, not mocks!
   */
  private async makeAPICall(
    config: ModelConfig,
    prompt: string,
    maxOutputTokens: number
  ): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
  }> {
    // Get API key from environment
    const apiKey = process.env[config.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(
        `GenerateContentAPIHelper: API key not found in environment variable: ${config.api.apiKeyEnvVar}`
      );
    }

    // Import Google Generative AI SDK dynamically
    const { GoogleGenerativeAI } = await import('@google/generative-ai');

    // Create client
    const genAI = new GoogleGenerativeAI(apiKey);

    // Get model
    const model = genAI.getGenerativeModel({
      model: config.id,
      generationConfig: {
        maxOutputTokens: Math.min(maxOutputTokens, config.limits.outputTokens),
        temperature: 0.7
      }
    });

    // Make API call
    const result = await model.generateContent(prompt);
    const response = result.response;

    // Extract text
    const text = response.text() || '';

    // Extract token counts
    // Note: TypeScript may not recognize usageMetadata, use type assertion
    const responseData = response as any;
    const inputTokens = responseData.usageMetadata?.promptTokenCount || this.estimateTokens(prompt);
    const outputTokens = responseData.usageMetadata?.candidatesTokenCount || this.estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens
    };
  }

  /**
   * Override calculateCost for Gemini model pricing
   *
   * Gemini pricing (as of 2024):
   * - Flash models: ~$0.075-0.375 per 1M tokens
   * - Pro models: ~$1.25-3.50 per 1M tokens
   */
  protected calculateCost(
    inputTokens: number,
    outputTokens: number,
    _modelConfig: ModelConfig
  ): number {
    // Gemini Flash pricing (most common helper model)
    // Input: $0.075 / 1M tokens, Output: $0.30 / 1M tokens
    const inputCostPer1M = 0.075;
    const outputCostPer1M = 0.30;

    const inputCost = (inputTokens / 1_000_000) * inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * outputCostPer1M;

    return inputCost + outputCost;
  }
}
