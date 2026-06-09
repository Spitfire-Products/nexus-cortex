/**
 * Helper Middleware Adapter Interface
 * Phase 1.5: Week 2 - API Pattern-Based Helper System
 *
 * Independent helper middleware architecture that operates separately
 * from the main adapter system. Each helper adapter is self-contained
 * and handles its own API pattern communication.
 */

import type { ModelConfig } from '../../models/ModelConfig.interface.js';

/**
 * Canonical message format (lightweight subset for helpers)
 * Helpers don't need full timeline/session metadata
 */
export interface HelperCanonicalMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    toolUse?: any;
    toolResult?: any;
  }>;
  timestamp?: string;
}

/**
 * Compaction result from helper model
 */
export interface CompactionResult {
  /** Summary/compacted content */
  summary: string;

  /** Compacted messages in canonical format */
  compactedMessages: HelperCanonicalMessage[];

  /** Original token count */
  originalTokens: number;

  /** Compressed token count */
  compressedTokens: number;

  /** Tokens saved */
  tokensSaved: number;

  /** Helper model used */
  helperModelId: string;

  /** Processing time in milliseconds */
  processingTime: number;

  /** Cost of helper model call */
  cost: number;
}

/**
 * Tool result summarization result
 */
export interface ToolSummaryResult {
  /** Summarized content */
  summary: string;

  /** Original token count */
  originalTokens: number;

  /** Summary token count */
  summaryTokens: number;

  /** Tokens saved */
  tokensSaved: number;

  /** Helper model used */
  helperModelId: string;

  /** Processing time in milliseconds */
  processingTime: number;

  /** Cost of helper model call */
  cost: number;
}

/**
 * Base interface for all helper middleware adapters
 *
 * Each adapter is self-contained and handles communication with
 * helper models using a specific API pattern (e.g., Messages API,
 * Chat Completions API, etc.)
 *
 * IMPORTANT: This system is INDEPENDENT from the main adapter system.
 * Helper adapters do not depend on or share code with main adapters.
 */
export interface HelperMiddlewareAdapter {
  /** API pattern this adapter handles (e.g., 'messages', 'chat/completions') */
  readonly apiPattern: string;

  /** Human-readable name for this adapter */
  readonly name: string;

  /**
   * Compact conversation history via helper model
   *
   * Takes a conversation history and compacts it to fit within a target
   * token budget using the configured helper model.
   *
   * @param messages - Messages in canonical format to compact
   * @param helperConfig - Helper model configuration (user-selected)
   * @param targetTokens - Target token count after compaction
   * @returns Compaction result with summary and metrics
   */
  compact(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    targetTokens: number
  ): Promise<CompactionResult>;

  /**
   * Summarize large tool result via helper model
   *
   * Takes a large tool result and summarizes it to fit within a maximum
   * token budget using the configured helper model.
   *
   * @param toolResult - Tool result content to summarize
   * @param helperConfig - Helper model configuration (user-selected)
   * @param maxTokens - Maximum tokens for summary
   * @returns Summary result with metrics
   */
  summarizeToolResult(
    toolResult: string,
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<ToolSummaryResult>;

  /**
   * Send messages directly to the helper model and return raw text.
   * Unlike compact(), this does NOT wrap messages with a compaction prompt.
   * Use for lightweight generation tasks (titles, summaries, predictions).
   */
  generate(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<string>;

  /**
   * Check if this adapter supports a given model config
   *
   * @param modelConfig - Model configuration to check
   * @returns True if this adapter can handle the model's API pattern
   */
  supportsModel(modelConfig: ModelConfig): boolean;

  /**
   * Estimate token count for content
   *
   * Provides rough token estimation for the helper model.
   * Uses simple heuristic (chars / 4) unless overridden.
   *
   * @param content - Content to estimate tokens for
   * @returns Estimated token count
   */
  estimateTokens(content: string): number;
}

/**
 * Abstract base class for helper adapters
 * Provides common functionality that all adapters can use
 */
export abstract class BaseHelperAdapter implements HelperMiddlewareAdapter {
  abstract readonly apiPattern: string;
  abstract readonly name: string;

  abstract compact(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    targetTokens: number
  ): Promise<CompactionResult>;

  abstract summarizeToolResult(
    toolResult: string,
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<ToolSummaryResult>;

  async generate(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<string> {
    const result = await this.compact(messages, helperConfig, maxTokens);
    return result.summary;
  }

  supportsModel(modelConfig: ModelConfig): boolean {
    return modelConfig.api.pattern === this.apiPattern;
  }

  estimateTokens(content: string): number {
    // Simple estimation: ~4 characters per token
    return Math.ceil(content.length / 4);
  }

  /**
   * Calculate cost for helper model call
   *
   * @param inputTokens - Input tokens used
   * @param outputTokens - Output tokens generated
   * @param modelConfig - Model configuration with pricing
   * @returns Cost in dollars
   */
  protected calculateCost(
    inputTokens: number,
    outputTokens: number,
    _modelConfig: ModelConfig
  ): number {
    // Most helper models charge per 1M tokens
    // Default rates (can be overridden per model in config)
    const inputCostPer1M = 0.50;  // $0.50 per 1M tokens (typical helper rate)
    const outputCostPer1M = 1.50; // $1.50 per 1M tokens (typical helper rate)

    const inputCost = (inputTokens / 1_000_000) * inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * outputCostPer1M;

    return inputCost + outputCost;
  }

  /**
   * Extract text content from messages
   *
   * @param messages - Messages to extract from
   * @returns Concatenated text content
   */
  protected extractTextContent(messages: HelperCanonicalMessage[]): string {
    return messages
      .map(msg => {
        if (typeof msg.content === 'string') {
          return msg.content;
        }
        return msg.content
          .filter(block => block.type === 'text')
          .map(block => block.text || '')
          .join('\n');
      })
      .join('\n\n');
  }

  /**
   * Create compaction prompt for helper model
   *
   * @param messages - Messages to compact
   * @param targetTokens - Target token count
   * @returns Prompt text for compaction
   */
  protected createCompactionPrompt(
    messages: HelperCanonicalMessage[],
    targetTokens: number
  ): string {
    const conversationText = this.extractTextContent(messages);

    return `Summarize this conversation in ~${targetTokens} tokens. Structure your summary using these categories (skip empty ones):

1. PRIMARY REQUEST: What the user is trying to accomplish and why.
2. KEY TECHNICAL CONCEPTS: Important terms, patterns, or architectural decisions established.
3. FILES AND CODE: Specific files read/modified, with key code sections or changes.
4. ERRORS AND FIXES: Problems encountered and how they were resolved.
5. DECISIONS MADE: Implementation choices, trade-offs accepted, approaches rejected.
6. ALL USER MESSAGES: Preserve the user's exact instructions and preferences — never paraphrase away constraints.
7. CURRENT STATE: What was just completed, what's in progress.
8. PENDING WORK: Tasks remaining, blockers, next steps.

CONVERSATION HISTORY:
${conversationText}

Preserve code snippets, file paths, and technical details verbatim. Target ~${targetTokens} tokens.

SUMMARY:`;
  }

  /**
   * Create tool result summarization prompt
   *
   * @param toolResult - Tool result to summarize
   * @param maxTokens - Maximum tokens for summary
   * @returns Prompt text for summarization
   */
  protected createToolSummaryPrompt(
    toolResult: string,
    maxTokens: number
  ): string {
    return `Please summarize the following tool result in approximately ${maxTokens} tokens while preserving essential information:

TOOL RESULT:
${toolResult}

INSTRUCTIONS:
- Extract key information and findings
- Preserve error messages if present
- Include relevant data points
- Omit verbose logs and redundant details
- Target length: ~${maxTokens} tokens

SUMMARY:`;
  }

  /**
   * Calculate safe input limit for a model
   *
   * Dynamically calculates how much content can be safely sent to the helper model
   * based on its context window, reserving space for prompts and outputs.
   *
   * @param helperConfig - Helper model configuration
   * @param targetOutputTokens - Expected output size
   * @returns Safe input token limit
   */
  protected calculateSafeInputLimit(
    helperConfig: ModelConfig,
    targetOutputTokens: number
  ): number {
    const contextWindow = helperConfig.limits?.contextWindow || 16000; // Default to smallest (GPT-3.5)

    // Reserve space for:
    // - Target output tokens
    // - System prompt and instructions (~500 tokens)
    // - Safety margin (10% of context)
    const safetyMargin = Math.floor(contextWindow * 0.1);
    const promptOverhead = 500;

    return contextWindow - targetOutputTokens - promptOverhead - safetyMargin;
  }

  /**
   * Check if content needs chunking
   *
   * @param content - Content to check
   * @param helperConfig - Helper model configuration
   * @param targetOutputTokens - Expected output size
   * @returns True if content exceeds safe input limit
   */
  protected needsChunking(
    content: string,
    helperConfig: ModelConfig,
    targetOutputTokens: number
  ): boolean {
    const contentTokens = this.estimateTokens(content);
    const safeLimit = this.calculateSafeInputLimit(helperConfig, targetOutputTokens);

    return contentTokens > safeLimit;
  }

  /**
   * Split content into chunks based on model's context limit
   *
   * Dynamically adjusts chunk size based on the helper model's capabilities.
   * Attempts to split on natural boundaries (paragraphs, sentences).
   *
   * @param content - Content to chunk
   * @param helperConfig - Helper model configuration
   * @param targetOutputTokens - Expected output per chunk
   * @returns Array of content chunks
   */
  protected chunkContent(
    content: string,
    helperConfig: ModelConfig,
    targetOutputTokens: number
  ): string[] {
    const safeLimit = this.calculateSafeInputLimit(helperConfig, targetOutputTokens);
    const targetChunkSize = safeLimit * 4; // Convert tokens to ~chars (4 chars per token)
    const chunks: string[] = [];

    // Split on paragraph boundaries first
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = '';

    for (const para of paragraphs) {
      // If single paragraph exceeds chunk size, split it further
      if (para.length > targetChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }

        // Split large paragraph into sentences
        const sentences = para.split(/\.\s+/);
        for (const sentence of sentences) {
          if ((currentChunk + sentence).length > targetChunkSize && currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence + '. ';
          } else {
            currentChunk += sentence + '. ';
          }
        }
        continue;
      }

      // Add paragraph to current chunk if it fits
      if ((currentChunk + para).length <= targetChunkSize) {
        currentChunk += para + '\n\n';
      } else {
        // Current chunk is full, start new one
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = para + '\n\n';
      }
    }

    // Add remaining content
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [content]; // Fallback to single chunk
  }

  /**
   * Get model-specific context information for logging
   *
   * @param helperConfig - Helper model configuration
   * @returns Context info string
   */
  protected getContextInfo(helperConfig: ModelConfig): string {
    const contextWindow = helperConfig.limits?.contextWindow || 0;
    const contextSizeKB = Math.floor(contextWindow / 1000);
    return `${helperConfig.id} (${contextSizeKB}K context)`;
  }
}
