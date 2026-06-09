/**
 * ResponsesAPI Helper Adapter
 * Phase 1.5: Week 2 - Independent Helper Middleware
 *
 * Handles helper model communication using OpenAI's Responses API pattern.
 * Used for stateful conversation models (GPT-5 Codex, Codex Mini, etc.).
 *
 * API Pattern: 'responses' (/v1/responses endpoint)
 * - Stateful conversation API with 30-day storage
 * - Different from /v1/chat/completions (Chat Completions API)
 * - Uses input items array with typed content blocks
 * - Supports previous_response_id for conversation chaining
 *
 * ARCHITECTURE:
 * - Self-contained: No dependency on main adapter system
 * - Makes real API calls using OpenAI SDK (client.responses.create)
 * - Supports GPT-5 Codex, Codex Mini, and future Responses API models
 * - Handles stateful conversation continuity
 */

import {
  BaseHelperAdapter,
  type HelperCanonicalMessage,
  type CompactionResult,
  type ToolSummaryResult
} from '../HelperMiddlewareAdapter.interface.js';
import type { ModelConfig } from '../../../models/ModelConfig.interface.js';

/**
 * Responses API input item format
 */
interface ResponsesAPIInputItem {
  type: 'message';
  role: 'user' | 'assistant' | 'developer';
  content: Array<{
    type: 'input_text';
    text: string;
  }>;
}

/**
 * Helper adapter for ResponsesAPI pattern ('responses')
 *
 * Uses OpenAI SDK's client.responses.create() for stateful conversation API.
 *
 * Supports: GPT-5 Codex, Codex Mini, future Responses API models
 * - gpt-5-codex: 400K context, advanced reasoning
 * - codex-mini-latest: Optimized for code tasks
 *
 * Key Features:
 * - 30-day response storage when store: true
 * - Conversation chaining via previous_response_id
 * - Uses max_output_tokens (not max_tokens)
 */
export class ResponsesAPIHelperAdapter extends BaseHelperAdapter {
  readonly apiPattern = 'responses';
  readonly name = 'ResponsesAPIHelperAdapter';

  /**
   * Compact conversation history via Responses API models
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

    // Convert to Responses API format
    const inputItems: ResponsesAPIInputItem[] = [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }]
      }
    ];

    // Make real API call via OpenAI Responses API
    const response = await this.makeAPICall(helperConfig, inputItems, targetTokens);

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
   * Summarize tool result via Responses API models
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

    // Convert to Responses API format
    const inputItems: ResponsesAPIInputItem[] = [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }]
      }
    ];

    // Make real API call via OpenAI Responses API
    const response = await this.makeAPICall(helperConfig, inputItems, maxTokens);

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
   * Make real API call to OpenAI Responses API
   *
   * CRITICAL: This makes REAL API calls via client.responses.create(), not mocks!
   */
  private async makeAPICall(
    config: ModelConfig,
    inputItems: ResponsesAPIInputItem[],
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
        `ResponsesAPIHelper: API key not found in environment variable: ${config.api.apiKeyEnvVar}`
      );
    }

    // Import OpenAI SDK dynamically
    const OpenAI = (await import('openai')).default;

    // Create client
    const client = new OpenAI({ apiKey });

    // Make API call to /v1/responses endpoint
    // NOTE: Uses max_output_tokens (not max_tokens!)
    const response = await client.responses.create({
      model: config.id,
      input: inputItems,
      max_output_tokens: Math.min(maxOutputTokens, config.limits.outputTokens),
      // Note: We don't use store: true or previous_response_id for helper calls
      // These are single-shot summarization requests, not ongoing conversations
    });

    // Extract text from output
    let text = '';
    if (response.output && response.output.length > 0) {
      for (const item of response.output) {
        if (item.type === 'message' && item.content) {
          for (const block of item.content) {
            if (block.type === 'output_text' && 'text' in block) {
              text += block.text;
            }
          }
        }
      }
    }

    // Use output_text if available (SDK convenience property)
    if (!text && response.output_text) {
      text = response.output_text;
    }

    // Estimate token counts (Responses API may not provide usage metadata)
    const inputText = inputItems.map(item =>
      item.content.map(c => c.text).join('')
    ).join('');
    const inputTokens = this.estimateTokens(inputText);
    const outputTokens = this.estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens
    };
  }

  /**
   * Override calculateCost for Responses API models
   *
   * GPT-5 Codex pricing (estimated, may vary):
   * - Input: ~$2.50 / 1M tokens
   * - Output: ~$10.00 / 1M tokens
   *
   * Note: Actual pricing should come from ModelConfig in production
   */
  protected calculateCost(
    inputTokens: number,
    outputTokens: number,
    _modelConfig: ModelConfig
  ): number {
    // Codex model pricing (conservative estimate)
    const inputCostPer1M = 2.50;
    const outputCostPer1M = 10.00;

    const inputCost = (inputTokens / 1_000_000) * inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * outputCostPer1M;

    return inputCost + outputCost;
  }
}
