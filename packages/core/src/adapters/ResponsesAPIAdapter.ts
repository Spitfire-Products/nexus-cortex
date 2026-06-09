/**
 * ResponsesAPIAdapter
 *
 * Pattern-based adapter for the /v1/responses API format (stateful conversation API).
 *
 * API Pattern: /v1/responses (stateful with 30-day storage)
 * Naming: snake_case (standard)
 * Structure: Input items with typed content blocks
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: OpenAI Responses API documentation
 *
 * Models using this adapter:
 * - gpt-5-codex (400K/128K context)
 * - codex-mini-latest
 * - Future models using Responses API
 *
 * Key Differences from Chat Completions API:
 * - Stateful: Uses previous_response_id for conversation continuity
 * - Storage: Responses stored for 30 days
 * - Endpoint: /v1/responses (not /v1/chat/completions)
 * - Format: Input items array with typed content blocks
 * - Output: Response object with output items array
 */

import {
  FormatAdapter,
  CanonicalTool,
  CanonicalToolUse,
  CanonicalToolResult,
  CanonicalMessage,
  CanonicalContentBlock
} from './FormatAdapter.interface.js';
import { ModelConfig } from '../models/ModelConfig.interface.js';
import { isServerSideTool } from '../tools/ServerSideTools.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * OpenAI Responses API Input Item (message)
 */
export interface OpenAIResponsesAPIMessageItem {
  /** Item type - "message" for text/chat messages */
  type: 'message';

  /** Message role: user, assistant, or developer (system) */
  role: 'user' | 'assistant' | 'developer';

  /** Content blocks array */
  content: OpenAIResponsesContentBlock[];
}

/**
 * OpenAI Responses API Function Call Output Item
 */
export interface OpenAIResponsesAPIFunctionCallOutputItem {
  /** Item type - "function_call_output" for tool results */
  type: 'function_call_output';

  /** The call_id from the function call */
  call_id: string;

  /** The output/result of the function */
  output: string;
}

/**
 * OpenAI Responses API Function Call Input Item (assistant tool request)
 * In the Responses API, function_call is a top-level input item, not a content block.
 */
export interface OpenAIResponsesAPIFunctionCallItem {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

/**
 * Union type for all input item types
 */
export type OpenAIResponsesAPIInputItem =
  | OpenAIResponsesAPIMessageItem
  | OpenAIResponsesAPIFunctionCallItem
  | OpenAIResponsesAPIFunctionCallOutputItem;

/**
 * OpenAI Responses API Content Block
 */
export type OpenAIResponsesContentBlock =
  | OpenAIResponsesInputTextBlock
  | OpenAIResponsesInputImageBlock
  | OpenAIResponsesOutputTextBlock
  | OpenAIResponsesFunctionCallBlock
  | OpenAIResponsesReasoningBlock;

/**
 * Input text content block
 */
export interface OpenAIResponsesInputTextBlock {
  type: 'input_text';
  text: string;
}

/**
 * Input image content block
 */
export interface OpenAIResponsesInputImageBlock {
  type: 'input_image';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * Output text content block
 */
export interface OpenAIResponsesOutputTextBlock {
  type: 'output_text';
  text: string;
}

/**
 * Function call content block
 */
export interface OpenAIResponsesFunctionCallBlock {
  type: 'function_call';
  id: string;
  name: string;
  arguments: string; // JSON string
}

/**
 * Reasoning content block (for o-series and gpt-5 models)
 */
export interface OpenAIResponsesReasoningBlock {
  type: 'reasoning';
  reasoning: string;
  encrypted_content?: string; // For stateful conversations
}

/**
 * OpenAI Responses API Output Item
 */
export interface OpenAIResponsesOutputItem {
  /** Item type */
  type: 'message' | 'function_call' | 'reasoning';

  /** Message role (for message type) */
  role?: 'assistant';

  /** Content blocks (for message type) */
  content?: OpenAIResponsesContentBlock[];

  /**
   * Function call details (for function_call type).
   *
   * R18c (multi-model bench finding): function_call items have BOTH `id`
   * (opaque item id like `fc_0190...`) AND `call_id` (the call id like
   * `call_7Ra...`). The `call_id` is what `function_call_output.call_id`
   * matches against. The streaming path captured this correctly (see
   * streamResponsesAPI L2132), but `fromProviderMessages` was reading
   * `item.id` and threading it as the canonical tool_use id — so when the
   * orchestrator later sent tool_result with that id as `call_id`, the
   * OpenAI API rejected with "No tool output found for function call
   * call_7Ra..." because the call_id never matched.
   */
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;

  /** Reasoning content (for reasoning type) */
  reasoning?: string;
  encrypted_content?: string;
}

/**
 * OpenAI Responses API Response Object
 */
export interface OpenAIResponsesResponse {
  /** Response ID for chaining conversations */
  id: string;

  /** Object type - always "response" */
  object: 'response';

  /** Model ID used */
  model: string;

  /** Output items array */
  output: OpenAIResponsesOutputItem[];

  /** Aggregated text output (SDK convenience property) */
  output_text?: string;

  /** Response status */
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';

  /** Error details (if failed) */
  error?: {
    code: string;
    message: string;
  };

  /** Creation timestamp */
  created: number;

  /** Conversation ID (if using conversations) */
  conversation?: {
    id: string;
  };
}

/**
 * OpenAI Responses API Tool Definition (Client-side)
 * Similar to Functions API but in Responses context
 */
export interface OpenAIResponsesAPITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: {
      type: 'object';
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
  };
}

/**
 * XAI Server-Side Tool Definition (for Responses API)
 *
 * Format for XAI's agentic server-side tools.
 * These tools execute autonomously on the server.
 *
 * Examples:
 * - { type: 'web_search' }
 * - { type: 'x_search' }
 * - { type: 'code_execution' }
 */
export interface XAIServerSideTool {
  type: 'web_search' | 'x_search' | 'code_execution' | string;

  // Optional configuration (provider-specific)
  config?: Record<string, unknown>;
}

/**
 * OpenAI Responses Adapter
 *
 * Converts between canonical format and OpenAI's Responses API format.
 * Supports stateful conversations with previous_response_id.
 */
export class ResponsesAPIAdapter implements FormatAdapter {
  readonly name = 'ResponsesAPIAdapter';
  readonly apiPatterns = ['responses'];

  /**
   * Convert canonical messages to OpenAI Responses API input items
   *
   * @param messages - Canonical messages
   * @param modelConfig - Model configuration
   * @returns OpenAI Responses input items array
   */
  toProviderMessages(
    messages: CanonicalMessage[],
    _modelConfig: ModelConfig
  ): OpenAIResponsesAPIInputItem[] {
    const inputItems: OpenAIResponsesAPIInputItem[] = [];

    for (const msg of messages) {
      // Convert based on message type
      if (msg.role === 'system') {
        // System messages become developer role in Responses API
        const textContent = msg.content
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('\n');

        inputItems.push({
          type: 'message',
          role: 'developer',
          content: [
            {
              type: 'input_text',
              text: textContent
            }
          ]
        });
      } else if (msg.role === 'user') {
        // User messages - handle text and tool results
        const contentBlocks: OpenAIResponsesContentBlock[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            contentBlocks.push({
              type: 'input_text',
              text: block.text || ''
            });
          } else if (block.type === 'tool_result') {
            // Tool results in Responses API are separate items with type 'function_call_output'
            // Don't add to contentBlocks - we'll add them as separate items below
          }
        }

        if (contentBlocks.length > 0) {
          inputItems.push({
            type: 'message',
            role: 'user',
            content: contentBlocks
          });
        }

        // Add tool results as separate function_call_output items
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.toolResult) {
            const resultText = typeof block.toolResult.content === 'string'
              ? block.toolResult.content
              : JSON.stringify(block.toolResult.content);

            // R19e: same deterministic normalization as tool_use above —
            // ensures paired call_ids match across function_call ↔ function_call_output.
            const rawId = block.toolResult.tool_use_id;
            const callId = rawId.startsWith('call_') ? rawId : `call_${rawId}`;
            inputItems.push({
              type: 'function_call_output',
              call_id: callId,
              output: resultText
            });
          }
        }
      } else if (msg.role === 'assistant') {
        // Assistant messages - split text into message item, tool calls into top-level function_call items.
        // The Responses API requires function_call as separate input items, NOT as content blocks
        // inside a message (that causes 422 "data did not match any variant of untagged enum ModelInput").
        const textBlocks: OpenAIResponsesContentBlock[] = [];

        for (const block of msg.content) {
          if (block.type === 'thinking') {
            // Round-trip reasoning blocks back as reasoning input items.
            // This preserves reasoning context for providers that benefit from it
            // (especially as fallback when previous_response_id chaining isn't available).
            const thinkingText = block.thinking || '';
            if (thinkingText) {
              // R19e: OpenAI Responses API requires reasoning item ids to
              // begin with `rs_`. The previous `reasoning-${Date.now()}` prefix
              // caused 400 "Expected an ID that begins with 'rs'" when a
              // thinking block from a non-Responses provider was round-tripped.
              const reasoningItem: any = {
                type: 'reasoning',
                id: `rs_${uuidv4()}`,
                summary: [{ type: 'summary_text', text: thinkingText }]
              };
              // Preserve encrypted_content for XAI stateful conversations
              const encryptedContent = (block as any).encrypted_content
                || (msg as any).metadata?.encrypted_content;
              if (encryptedContent) {
                reasoningItem.encrypted_content = encryptedContent;
              }
              inputItems.push(reasoningItem);
            }
          } else if (block.type === 'text') {
            textBlocks.push({
              type: 'output_text',
              text: block.text || ''
            });
          } else if (block.type === 'tool_use' && block.toolUse) {
            // R19e: OpenAI Responses API rejects function_call.id that doesn't
            // begin with 'fc_'. When the same orchestrator session previously
            // routed through another provider (Anthropic `toolu_*`, Gemini
            // `toolu_*`, or another non-Responses path), canonical tool_use
            // ids carry that foreign prefix. Normalize: if the id isn't already
            // an `fc_` item id, prepend `fc_`; same shape for `call_id` with
            // `call_`. The transform is deterministic so paired
            // function_call_output items below get the matching call_id.
            const canonicalId = block.toolUse.id;
            const fcId = canonicalId.startsWith('fc_') ? canonicalId : `fc_${canonicalId}`;
            const callId = canonicalId.startsWith('call_') ? canonicalId : `call_${canonicalId}`;
            inputItems.push({
              type: 'function_call',
              id: fcId,
              name: block.toolUse.name,
              arguments: JSON.stringify(block.toolUse.input),
              call_id: callId
            } as OpenAIResponsesAPIFunctionCallItem);
          }
        }

        if (textBlocks.length > 0) {
          inputItems.push({
            type: 'message',
            role: 'assistant',
            content: textBlocks
          });
        }
      }
    }

    return inputItems;
  }

  /**
   * Convert OpenAI Responses API output to canonical messages
   *
   * @param providerMessages - OpenAI Responses output items (or full response object)
   * @param modelConfig - Model configuration
   * @param sessionContext - Session context for timeline tracking
   * @returns Canonical messages
   */
  fromProviderMessages(
    providerMessages: unknown[] | unknown,
    modelConfig: ModelConfig,
    sessionContext: {
      sessionId: string;
      conversationId: string;
      turnNumber: number;
    }
  ): CanonicalMessage[] {
    // Suppress unused modelConfig warning - passed to conversion methods
    void modelConfig;
    // Handle full response object vs output items array
    let outputItems: OpenAIResponsesOutputItem[];

    if (Array.isArray(providerMessages)) {
      // Check if it's an array of output items or an array containing the response object
      if (providerMessages.length === 1 && providerMessages[0].object === 'response') {
        // It's [responseObject] - extract output array
        const response = providerMessages[0] as OpenAIResponsesResponse;
        outputItems = response.output || [];
      } else {
        // It's an array of output items
        outputItems = providerMessages as OpenAIResponsesOutputItem[];
      }
    } else {
      const response = providerMessages as OpenAIResponsesResponse;
      outputItems = response.output || [];
    }

    if (process.env.DEBUG === 'true') {
      console.log('[ResponsesAPIAdapter] fromProviderMessages - outputItems count:', outputItems.length);
      console.log('[ResponsesAPIAdapter] outputItems types:', outputItems.map(i => i.type));
    }

    // The orchestrator reads messages[0] and expects ALL content (text + tool_use) in a single
    // canonical message — same pattern as Anthropic Messages API. Responses API returns separate
    // output items (message, function_call, *_call), so we merge them into one message here.
    // R27: reasoning is merged into the SINGLE assistant message as leading
    // thinking block(s) — NOT prepended as a separate message. The orchestrator
    // only reads messages[0]; a separate reasoning message made messages[0]
    // thinking-only, hiding the real text/tool_use → "Empty response detected".
    // This mirrors MessagesAPIAdapter (one assistant message: [thinking, text,
    // tool_use]), which is why the Messages API path never had this bug.
    const reasoningBlocks: CanonicalContentBlock[] = [];
    let reasoningEncrypted: string | undefined;
    const allContentBlocks: CanonicalContentBlock[] = [];

    for (const item of outputItems) {
      if (process.env.DEBUG === 'true') {
        console.log('[ResponsesAPIAdapter] Processing item type:', item.type);
      }

      if (item.type === 'message') {
        // Extract content blocks from message item and merge into single response
        if (item.content && Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === 'output_text' && 'text' in block) {
              allContentBlocks.push({
                type: 'text',
                text: (block as OpenAIResponsesOutputTextBlock).text || ''
              });
            } else if (block.type === 'function_call') {
              const functionCall = block as OpenAIResponsesFunctionCallBlock;
              allContentBlocks.push({
                type: 'tool_use',
                toolUse: this.fromProviderToolUse(functionCall, modelConfig)
              });
            }
          }
        }
        if (process.env.DEBUG === 'true') {
          console.log('[ResponsesAPIAdapter] Merged message content:', allContentBlocks.length, 'blocks total');
        }
      } else if (item.type === 'function_call') {
        // Client-side function call — add as tool_use content block in the merged message.
        // R18c: prefer `call_id` over `id` — the former matches function_call_output
        // (and is what tool_result needs to use), the latter is just an opaque item id.
        const functionCall: OpenAIResponsesFunctionCallBlock = {
          type: 'function_call',
          id: item.call_id || item.id || '',
          name: item.name || '',
          arguments: item.arguments || '{}'
        };
        allContentBlocks.push({
          type: 'tool_use',
          toolUse: this.fromProviderToolUse(functionCall, modelConfig)
        });
        if (process.env.DEBUG === 'true') {
          console.log('[ResponsesAPIAdapter] Merged function_call:', item.name);
        }
      } else if (item.type === 'reasoning') {
        // xAI sends reasoning as `summary: [{ type:'summary_text', text }]`;
        // OpenAI uses a `reasoning` string. Read both so the thinking content
        // is preserved (XAI cache rules require keeping reasoning_content).
        const summaryText = Array.isArray((item as any).summary)
          ? (item as any).summary
              .map((s: any) => (typeof s === 'string' ? s : s?.text || ''))
              .filter(Boolean)
              .join('\n')
          : '';
        const reasoningText = (item as any).reasoning || summaryText || '';
        if (reasoningText) {
          reasoningBlocks.push({ type: 'thinking', thinking: reasoningText } as any);
        }
        if ((item as any).encrypted_content) {
          reasoningEncrypted = (item as any).encrypted_content;
        }
      } else if ((item as any).type?.endsWith('_call')) {
        // XAI server-side tool calls (web_search_call, x_search_call, code_execution_call, etc.)
        // Autonomous executions on xAI servers. Surface as text annotations in the merged message.
        const serverItem = item as any;
        const toolName = serverItem.name || serverItem.type.replace('_call', '');
        const args = serverItem.arguments || '';
        allContentBlocks.push({
          type: 'text' as const,
          text: `[Server-side tool: ${toolName}(${args})]`
        });
        if (process.env.DEBUG === 'true') {
          console.log('[ResponsesAPIAdapter] Server-side tool call merged:', toolName);
        }
      }
    }

    // Build ONE canonical assistant message: thinking block(s) first, then
    // text / tool_use — the shape the orchestrator (messages[0]) expects.
    const mergedBlocks: CanonicalContentBlock[] = [...reasoningBlocks, ...allContentBlocks];
    const canonicalMessages: CanonicalMessage[] = [];

    if (mergedBlocks.length > 0) {
      const hasToolUse = mergedBlocks.some(b => b.type === 'tool_use');
      canonicalMessages.push({
        uuid: this.generateMessageUuid(),
        timestamp: new Date().toISOString(),
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: sessionContext.turnNumber
        },
        role: 'assistant',
        type: hasToolUse ? 'tool_request' : 'text',
        content: mergedBlocks,
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        },
        ...(reasoningEncrypted
          ? { metadata: { reasoning: true, encrypted_content: reasoningEncrypted } }
          : {})
      });
    }

    if (process.env.DEBUG === 'true') {
      const blockTypes = allContentBlocks.map(b => b.type);
      console.log('[ResponsesAPIAdapter] Returning', canonicalMessages.length, 'canonical messages',
        `(${blockTypes.join(', ')} in merged response)`);
    }
    return canonicalMessages;
  }

  /**
   * Convert canonical tools to OpenAI Responses API tool format
   *
   * Handles BOTH client-side and server-side tools:
   * - Client-side: Standard function calling format { type: 'function', function: {...} }
   * - Server-side (XAI): Simple type format { type: 'web_search' }
   *
   * @param tools - Canonical tool definitions
   * @param modelConfig - Model configuration
   * @returns OpenAI Responses tools array (mixed client + server)
   */
  toProviderTools(
    tools: CanonicalTool[],
    modelConfig: ModelConfig
  ): (OpenAIResponsesAPITool | XAIServerSideTool)[] {
    const provider = modelConfig.provider;

    const result = tools.map(tool => {
      // Check if this is a server-side tool for this provider
      if (isServerSideTool(provider, tool.name)) {
        // R20b: OpenAI Responses API server-side tools have per-tool required
        // shapes that differ from XAI's simple `{ type: 'name' }` form.
        // - code_interpreter requires `container` (use `{ type: 'auto' }` for
        //   ephemeral managed container).
        // - file_search requires `vector_store_ids` (user must provide via
        //   serverConfig metadata — emit empty array as placeholder; OpenAI
        //   will 400 if unconfigured, which is the correct failure mode).
        // - web_search, image_generation are simple type-only.
        // XAI tools all use the simple form.
        let serverTool: any;
        if (provider === 'openai') {
          if (tool.name === 'code_interpreter') {
            const cfg = (tool.metadata as any)?.serverConfig?.container ?? { type: 'auto' };
            serverTool = { type: 'code_interpreter', container: cfg };
          } else if (tool.name === 'file_search') {
            const vsIds = (tool.metadata as any)?.serverConfig?.vector_store_ids ?? [];
            serverTool = { type: 'file_search', vector_store_ids: vsIds };
          } else {
            serverTool = { type: tool.name };
          }
        } else {
          // XAI (and others) — simple type form
          serverTool = { type: tool.name };
        }
        if (process.env.DEBUG === 'true') {
          console.log('[ResponsesAPIAdapter] Converting server-side tool:', tool.name, '→', serverTool);
        }
        return serverTool as XAIServerSideTool;
      }

      // Client-side tool - Responses API uses FLAT format with type field
      // Hybrid: type + flat name/description/parameters (not nested in 'function')
      return {
        type: 'function',  // Required by API
        name: tool.name, // Already has correct naming from gateway
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.schema.properties,
          required: tool.schema.required,
          ...this.extractAdditionalSchemaProperties(tool.schema)
        }
      } as any; // Flat format with type for Responses API
    });

    if (process.env.DEBUG === 'true') {
      console.log(`[ResponsesAPIAdapter] Final provider tools: [${result.length} tools]`);
    }
    return result;
  }

  /**
   * Convert provider tools to canonical format
   *
   * @param providerTools - OpenAI Responses tools array
   * @param _modelConfig - Model configuration
   * @returns Canonical tool definitions
   */
  fromProviderTools(
    providerTools: unknown[],
    _modelConfig: ModelConfig
  ): CanonicalTool[] {
    const responsesTools = providerTools as OpenAIResponsesAPITool[];

    return responsesTools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      schema: {
        type: 'object',
        properties: (tool.function.parameters.properties || {}) as Record<string, any>,
        required: tool.function.parameters.required,
        ...this.extractAdditionalSchemaProperties(tool.function.parameters)
      },
      metadata: {
        originalName: tool.function.name, // Store original name as-is
        sourceProvider: 'openai-responses'
      }
    }));
  }

  /**
   * Convert canonical tool use to OpenAI Responses function call
   *
   * @param toolUse - Canonical tool use
   * @param modelConfig - Model configuration
   * @returns OpenAI Responses function call
   */
  toProviderToolUse(
    toolUse: CanonicalToolUse,
    _modelConfig: ModelConfig
  ): OpenAIResponsesFunctionCallBlock {
    // Gateway has already applied correct naming convention
    return {
      type: 'function_call',
      id: toolUse.id,
      name: toolUse.name, // Already has correct naming from gateway
      arguments: JSON.stringify(toolUse.input)
    };
  }

  /**
   * Convert OpenAI Responses function call to canonical format
   *
   * @param providerToolUse - OpenAI Responses function call
   * @param modelConfig - Model configuration
   * @returns Canonical tool use
   */
  fromProviderToolUse(
    providerToolUse: unknown,
    modelConfig: ModelConfig
  ): CanonicalToolUse {
    const functionCall = providerToolUse as OpenAIResponsesFunctionCallBlock;

    let input: Record<string, unknown>;
    try {
      input = JSON.parse(functionCall.arguments);
    } catch (error) {
      console.error(`Failed to parse function arguments: ${functionCall.arguments}`);
      input = {};
    }

    return {
      id: functionCall.id,
      name: functionCall.name,
      input: input,
      metadata: {
        sourceProvider: modelConfig.provider,
        modelId: modelConfig.id
      }
    };
  }

  /**
   * Convert canonical tool result to OpenAI Responses format
   *
   * Note: Responses API doesn't have a direct tool result message type.
   * Tool results are typically sent as user messages with text content.
   *
   * @param toolResult - Canonical tool result
   * @param _modelConfig - Model configuration
   * @returns Input text block with tool result
   */
  toProviderToolResult(
    toolResult: CanonicalToolResult,
    _modelConfig: ModelConfig
  ): OpenAIResponsesInputTextBlock {
    let content: string;
    if (typeof toolResult.content === 'string') {
      content = toolResult.content;
    } else {
      content = JSON.stringify(toolResult.content, null, 2);
    }

    if (toolResult.is_error) {
      content = `ERROR: ${content}`;
    }

    return {
      type: 'input_text',
      text: `Tool result (${toolResult.tool_use_id}): ${content}`
    };
  }

  /**
   * Convert OpenAI Responses tool result to canonical format
   *
   * @param providerToolResult - OpenAI Responses tool result (text block)
   * @param _modelConfig - Model configuration
   * @returns Canonical tool result
   */
  fromProviderToolResult(
    providerToolResult: unknown,
    _modelConfig: ModelConfig
  ): CanonicalToolResult {
    const textBlock = providerToolResult as OpenAIResponsesInputTextBlock;
    const text = textBlock.text;

    // Parse tool result format: "Tool result (tool_id): content"
    const match = text.match(/^Tool result \((.*?)\): (.*)$/s);

    if (match) {
      const [, tool_use_id, content] = match;
      const contentStr = content ?? '';
      const is_error = contentStr.startsWith('ERROR:');
      const cleanContent = is_error ? contentStr.replace(/^ERROR:\s*/, '') : contentStr;

      return {
        tool_use_id: tool_use_id ?? '',
        content: cleanContent,
        is_error,
        metadata: {}
      };
    }

    // Fallback: treat as generic tool result
    return {
      tool_use_id: 'unknown',
      content: text,
      is_error: false,
      metadata: {}
    };
  }

  /**
   * Validate tool for OpenAI Responses API compatibility
   *
   * @param tool - Canonical tool to validate
   * @param modelConfig - Model configuration
   * @returns Validation result
   */
  validateTool(
    tool: CanonicalTool,
    _modelConfig: ModelConfig
  ): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    // Gateway validates naming; adapter validates API format only
    // Tools should already have correct naming when they reach this point

    // Check schema is object type
    if (tool.schema.type !== 'object') {
      errors.push(`Tool schema type must be "object" for OpenAI Responses API`);
    }

    // Check properties exist
    if (!tool.schema.properties) {
      errors.push(`Tool schema must have properties defined`);
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Get maximum tools supported
   *
   * @param modelConfig - Model configuration
   * @returns Max tools
   */
  getMaxTools(modelConfig: ModelConfig): number {
    return modelConfig.tools.maxTools;
  }

  /**
   * Check if parallel tool calls are supported
   *
   * @param modelConfig - Model configuration
   * @returns true if parallel tool calls supported
   */
  supportsParallelToolCalls(modelConfig: ModelConfig): boolean {
    return modelConfig.tools.parallelToolCalls;
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Extract additional JSON Schema properties
   */
  private extractAdditionalSchemaProperties(
    schema: Record<string, unknown>
  ): Record<string, unknown> {
    const { type, properties, required, ...additional } = schema;
    return additional;
  }


  /**
   * Generate unique message UUID
   */
  private generateMessageUuid(): string {
    const n: number = Math.random();
    return `msg_${Date.now()}_${n.toString(36).substring(2, 11)}`;
  }
}

/**
 * Default singleton instance
 */
export const responsesAPIAdapter = new ResponsesAPIAdapter();
