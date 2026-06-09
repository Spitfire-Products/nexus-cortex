/**
 * Chat Completions API Helper Adapter
 * Phase 1.5: Week 2 - Independent Helper Middleware
 *
 * Handles helper model communication using Chat Completions API pattern
 * (/v1/chat/completions). Used by OpenAI, DeepSeek, Groq, and other
 * OpenAI-compatible providers.
 *
 * ARCHITECTURE:
 * - Self-contained: No dependency on main adapter system
 * - Makes real API calls using fetch
 * - Converts canonical format to Chat Completions format internally
 * - Handles compaction and tool result summarization
 */

import {
  BaseHelperAdapter,
  type HelperCanonicalMessage,
  type CompactionResult,
  type ToolSummaryResult
} from '../HelperMiddlewareAdapter.interface.js';
import type { ModelConfig } from '../../../models/ModelConfig.interface.js';

/**
 * Chat Completions API format
 */
interface ChatCompletionsMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionsRequest {
  model: string;
  messages: ChatCompletionsMessage[];
  max_tokens?: number;
  temperature?: number;
}

interface ChatCompletionsResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Helper adapter for Chat Completions API pattern
 *
 * Supports: OpenAI GPT models, DeepSeek, Groq, and any OpenAI-compatible API
 */
export class ChatCompletionsAPIHelperAdapter extends BaseHelperAdapter {
  readonly apiPattern = 'chat/completions';
  readonly name = 'ChatCompletionsAPIHelperAdapter';

  /**
   * Compact conversation history via Chat Completions API helper model
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

    // Check if content needs chunking (smart chunking based on model's context limit)
    if (this.needsChunking(originalText, helperConfig, targetTokens)) {
      const contentTokens = this.estimateTokens(originalText);
      const contextInfo = this.getContextInfo(helperConfig);
      console.log(` ⚠  Content too large (${contentTokens} tokens) for ${contextInfo}, using smart chunking...`);

      return await this.compactWithChunking(messages, helperConfig, targetTokens, startTime);
    }

    // Create compaction prompt
    const prompt = this.createCompactionPrompt(messages, targetTokens);

    // Convert to Chat Completions format
    const chatMessages: ChatCompletionsMessage[] = [
      {
        role: 'system',
        content: 'You are a helpful assistant that summarizes conversations concisely while preserving key information.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    // Make real API call
    const response = await this.makeAPICall(helperConfig, chatMessages, targetTokens);

    // Extract summary from response
    const summary = response.choices[0]?.message.content || '';
    const compressedTokens = response.usage.completion_tokens;
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
      response.usage.prompt_tokens,
      response.usage.completion_tokens,
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
   * Summarize tool result via Chat Completions API helper model
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

    // Convert to Chat Completions format
    const chatMessages: ChatCompletionsMessage[] = [
      {
        role: 'system',
        content: 'You are a helpful assistant that summarizes tool results concisely while preserving essential information.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    // Make real API call
    const response = await this.makeAPICall(helperConfig, chatMessages, maxTokens);

    // Extract summary from response
    const summary = response.choices[0]?.message.content || '';
    const summaryTokens = response.usage.completion_tokens;
    const tokensSaved = originalTokens - summaryTokens;

    const processingTime = Date.now() - startTime;
    const cost = this.calculateCost(
      response.usage.prompt_tokens,
      response.usage.completion_tokens,
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
   * Compact with chunking for large content
   * Uses smart chunking from base adapter
   */
  private async compactWithChunking(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    targetTokens: number,
    startTime: number
  ): Promise<CompactionResult> {
    const originalText = this.extractTextContent(messages);
    const originalTokens = this.estimateTokens(originalText);

    // Use base class smart chunking (dynamically calculates based on model config)
    const chunks = this.chunkContent(originalText, helperConfig, targetTokens);
    const chunkSummaries: string[] = [];

    console.log(` Processing ${chunks.length} chunks (smart chunking for ${this.getContextInfo(helperConfig)})...`);

    // Compress each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      console.log(` ⏳ Chunk ${i + 1}/${chunks.length} (${this.estimateTokens(chunk)} tokens)...`);

      try {
        const chatMessages: ChatCompletionsMessage[] = [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes conversations concisely.'
          },
          {
            role: 'user',
            content: `Summarize this conversation section in ${Math.floor(targetTokens / chunks.length)} tokens:\n\n${chunk}`
          }
        ];

        const response = await this.makeAPICall(
          helperConfig,
          chatMessages,
          Math.floor(targetTokens / chunks.length)
        );

        chunkSummaries.push(response.choices[0]?.message.content || '');
      } catch (error: any) {
        console.warn(` ⚠  Chunk ${i + 1} failed: ${error.message}`);
        chunkSummaries.push(`[Chunk ${i + 1} compression failed]`);
      }
    }

    // Combine chunk summaries
    const combinedSummary = chunkSummaries.join('\n\n---\n\n');

    // If combined is still too large, do one final pass
    const combinedTokens = this.estimateTokens(combinedSummary);
    if (combinedTokens > targetTokens) {
      console.log(` Final compression pass (${combinedTokens} → ${targetTokens} tokens)...`);

      const finalMessages: ChatCompletionsMessage[] = [
        {
          role: 'system',
          content: 'You are a helpful assistant that summarizes conversations concisely.'
        },
        {
          role: 'user',
          content: `Combine and summarize these section summaries into ${targetTokens} tokens:\n\n${combinedSummary}`
        }
      ];

      const finalResponse = await this.makeAPICall(helperConfig, finalMessages, targetTokens);
      const finalSummary = finalResponse.choices[0]?.message.content || '';
      const compressedTokens = finalResponse.usage.completion_tokens;

      // Create compacted messages
      const recentCount = Math.min(5, messages.length);
      const recentMessages = messages.slice(-recentCount);
      const compactedMessages: HelperCanonicalMessage[] = [
        {
          role: 'system',
          content: `[Compacted History]\n${finalSummary}`
        },
        ...recentMessages
      ];

      const processingTime = Date.now() - startTime;
      const cost = this.calculateCost(finalResponse.usage.prompt_tokens, compressedTokens, helperConfig);

      return {
        summary: finalSummary,
        compactedMessages,
        originalTokens,
        compressedTokens,
        tokensSaved: originalTokens - compressedTokens,
        helperModelId: helperConfig.id,
        processingTime,
        cost
      };
    }

    // Use combined summary as-is
    const compressedTokens = combinedTokens;
    const recentCount = Math.min(5, messages.length);
    const recentMessages = messages.slice(-recentCount);
    const compactedMessages: HelperCanonicalMessage[] = [
      {
        role: 'system',
        content: `[Compacted History]\n${combinedSummary}`
      },
      ...recentMessages
    ];

    const processingTime = Date.now() - startTime;
    // Estimate cost from all chunks
    const estimatedInputTokens = originalTokens;
    const cost = this.calculateCost(estimatedInputTokens, compressedTokens, helperConfig);

    return {
      summary: combinedSummary,
      compactedMessages,
      originalTokens,
      compressedTokens,
      tokensSaved: originalTokens - compressedTokens,
      helperModelId: helperConfig.id,
      processingTime,
      cost
    };
  }

  /**
   * Send messages directly without compaction wrapping.
   */
  async generate(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<string> {
    const chatMessages: ChatCompletionsMessage[] = messages.map(m => ({
      role: (m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'system') as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : m.content.map((b: any) => b.text || '').join('\n'),
    }));
    const response = await this.makeAPICall(helperConfig, chatMessages, maxTokens);
    return response.choices[0]?.message.content || '';
  }

  /**
   * Make real API call to Chat Completions endpoint
   *
   * CRITICAL: This makes REAL API calls, not mocks!
   */
  protected async makeAPICall(
    config: ModelConfig,
    messages: ChatCompletionsMessage[],
    maxTokens: number
  ): Promise<ChatCompletionsResponse> {
    // Get API key from environment
    const apiKey = process.env[config.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(
        `ChatCompletionsAPIHelper: API key not found in environment variable: ${config.api.apiKeyEnvVar}`
      );
    }

    // Get request URL (endpoint contains full URL)
    const url = config.api.endpoint;

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [config.api.authHeader]: `${config.api.authPrefix} ${apiKey}`
    };

    // Add version header if specified
    if (config.api.versionHeader) {
      headers[config.api.versionHeader.name] = config.api.versionHeader.value;
    }

    // Build request body
    const requestBody: ChatCompletionsRequest = {
      model: config.id,
      messages,
      max_tokens: Math.min(maxTokens, config.limits.outputTokens),
      temperature: 0.7
    };

    // Make real API call
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChatCompletionsAPIHelper: API call failed (${response.status}): ${errorText}`
      );
    }

    const data = await response.json() as ChatCompletionsResponse;
    return data;
  }
}
