/**
 * APITransport Interface
 *
 * Abstracts HTTP communication with AI provider APIs.
 * Format conversion is handled separately by format adapters (already browser-safe).
 * This interface only handles the HTTP transport layer.
 *
 * Node.js impl: wraps APIClient (uses @anthropic-ai/sdk, openai, @google/generative-ai)
 * Browser impl: uses fetch() + CORS proxy
 *
 * @module interfaces/APITransport
 */

import type { ModelConfig } from '@nexus-cortex/types';
import type { CanonicalToolUse } from '@nexus-cortex/types';

/**
 * Provider-agnostic API response
 */
export interface APIResponse {
  /** Provider-specific response object */
  data: any;
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
}

/**
 * Stream chunk for real-time UI updates
 */
export interface StreamChunk {
  /** Chunk type */
  type:
    | 'text_delta'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_start'
    | 'message_delta'
    | 'message_stop'
    | 'tool_use_complete'
    | 'tool_result'
    | 'thinking_delta'
    | 'error';

  /** Chunk data (provider-specific) */
  data?: any;

  /** Text delta (for text chunks) */
  delta?: string;

  /** Accumulated snapshot (optional) */
  snapshot?: string;

  /** Tool use block (for type === 'tool_use_complete') */
  toolUse?: CanonicalToolUse;

  /** Tool result (for type === 'tool_result') */
  toolResult?: {
    tool_use_id: string;
    tool_name: string;
    content: string;
    is_error?: boolean;
    metadata?: any;
  };

  /** Error details (for type === 'error') */
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Streaming response — composite of chunk generator + final assembled message.
 *
 * IMPORTANT: This is NOT just an AsyncGenerator. The finalMessage promise
 * resolves after the stream completes and provides assembled metadata,
 * thinking block assembly, token usage, etc.
 */
export interface StreamingResponse {
  /** Async generator for real-time chunks */
  chunks: AsyncGenerator<StreamChunk, void, unknown>;
  /** Promise that resolves to final accumulated message */
  finalMessage: Promise<any>;
}

/**
 * Prepared request — format-converted and ready for HTTP transmission.
 * Created by GatewayTranslationLayer (already browser-safe).
 */
export interface PreparedRequest {
  /** Provider-specific messages */
  messages: unknown[];
  /** Provider-specific tools (if applicable) */
  tools?: unknown[];
  /** Request headers */
  headers: Record<string, string>;
  /** Request parameters */
  parameters: Record<string, unknown>;
  /** System message (handled separately for some providers) */
  systemMessage?: string;
  /** Model ID to use */
  modelId: string;

  /** Previous response ID for stateful Responses API chaining (XAI, OpenAI) */
  previousResponseId?: string;

  /**
   * Conversation/session identifier for cache-routing.
   * Used as `x-grok-conv-id` header (Chat Completions / Messages API) and
   * `prompt_cache_key` body field (Responses API). Maximizes XAI cache hits
   * by routing same-session requests to the same server.
   */
  conversationId?: string;
}

/**
 * API Transport — HTTP layer abstraction for AI provider communication.
 *
 * Handles sending requests and receiving responses from AI provider APIs.
 * Format conversion is NOT this interface's concern — that's handled by
 * the format adapters (MessagesAPIAdapter, ChatCompletionsAPIAdapter, etc.)
 * which are already browser-compatible pure TypeScript.
 */
export interface APITransport {
  /**
   * Send a non-streaming request to an AI provider.
   *
   * @param request - Format-converted request ready for transmission
   * @param modelConfig - Model configuration (determines endpoint, auth, etc.)
   * @returns Provider-specific response
   */
  sendRequest(request: PreparedRequest, modelConfig: ModelConfig): Promise<APIResponse>;

  /**
   * Send a streaming request to an AI provider.
   *
   * @param request - Format-converted request ready for transmission
   * @param modelConfig - Model configuration (determines endpoint, auth, etc.)
   * @returns Composite of chunk generator + final message promise
   */
  streamRequest(request: PreparedRequest, modelConfig: ModelConfig): StreamingResponse;
}
