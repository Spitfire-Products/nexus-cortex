/**
 * MessagesAPIAdapter
 *
 * Pattern-based adapter for the /messages API format used by Anthropic Claude and XAI Grok.
 *
 * API Pattern: /messages endpoint with input_schema
 * Naming: snake_case (CRITICAL - NOT PascalCase)
 * Structure: Flat (no wrapper)
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: SDK_FINDINGS.md, ANTHROPIC_TOOL_FORMAT_REFERENCE.md
 *
 * NOTE: This adapter handles any provider using the /messages API pattern,
 * including Anthropic Claude and XAI Grok.
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

/**
 * Messages API Tool Format
 *
 * As used by providers implementing the /messages API pattern
 */
export interface MessagesAPITool {
  /** Tool name (snake_case - REQUIRED) */
  name: string;

  /** Human-readable description (optional but recommended) */
  description?: string;

  /** Input schema - NOTE: property name is "input_schema" */
  input_schema: {
    /** Must be 'object' */
    type: 'object';

    /** Property definitions */
    properties?: Record<string, unknown>;

    /** Required property names */
    required?: string[];

    /** Additional JSON Schema properties */
    [key: string]: unknown;
  };

  /** PTC: Defer tool loading — schema sent but not loaded until Tool Search finds it */
  defer_loading?: boolean;

  /** PTC: Restrict which callers can invoke this tool */
  allowed_callers?: string[];
}

/**
 * Union type for Messages API tool entries including PTC system tools.
 * Used when building tool arrays for PTC-enabled requests.
 */
export type MessagesAPIToolEntry =
  | MessagesAPITool
  | { type: 'code_execution_20260120' }
  | { type: 'tool_search_tool_bm25_20251119' };

/**
 * Anthropic ToolUse (tool call from model)
 */
export interface MessagesAPIToolUse {
  /** Unique ID for this tool use */
  id: string;

  /** Type marker */
  type: 'tool_use';

  /** Tool name */
  name: string;

  /** Input arguments */
  input: Record<string, unknown>;
}

/**
 * Anthropic ToolResult (tool execution result)
 */
export interface MessagesAPIToolResult {
  /** Type marker */
  type: 'tool_result';

  /** ID of the tool use this is responding to */
  tool_use_id: string;

  /** Result content (string or structured data) */
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;

  /** Whether this is an error */
  is_error?: boolean;
}

/**
 * Anthropic Content Block (part of message)
 */
export type MessagesAPIContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | object; is_error?: boolean }
  | { type: 'thinking'; thinking: string; signature?: string } // signature for Claude extended thinking
  | { type: 'redacted_thinking'; data: string } // XAI grok-4/4.1 encrypted reasoning, Anthropic redacted thinking
  | { type: 'server_tool_use'; id: string; name: string; input: Record<string, unknown> } // PTC: server-side tool call
  | { type: 'code_execution_tool_result'; tool_use_id: string; content: string; output?: { stdout: string; stderr: string } }; // PTC: code execution result

/**
 * Anthropic Message
 *
 * As defined in @anthropic-ai/sdk Messages API
 */
export interface MessagesAPIMessage {
  /** Message role */
  role: 'user' | 'assistant';

  /** Message content blocks */
  content: string | MessagesAPIContentBlock[];
}

/**
 * Anthropic Messages Tools Adapter
 *
 * Converts between canonical format and Anthropic's tool format.
 * Also compatible with XAI Grok (uses same API).
 */
export class MessagesAPIAdapter implements FormatAdapter {
  readonly name = 'MessagesAPIAdapter';
  readonly apiPatterns = ['messages'];

  /**
   * Convert canonical messages to Anthropic message format
   *
   * @param messages - Canonical messages
   * @param modelConfig - Model configuration
   * @returns Anthropic message array
   */
  toProviderMessages(
    messages: CanonicalMessage[],
    modelConfig: ModelConfig
  ): MessagesAPIMessage[] {
    return messages
      .filter(msg => msg.role !== 'system') // System messages handled separately in API
      .map(msg => this.convertToMessagesAPIMessage(msg, modelConfig));
  }

  /**
   * Convert Anthropic messages to canonical format
   *
   * @param providerMessages - Anthropic messages
   * @param modelConfig - Model configuration
   * @param sessionContext - Session context for timeline tracking
   * @returns Canonical messages
   */
  fromProviderMessages(
    providerMessages: unknown[],
    modelConfig: ModelConfig,
    sessionContext: {
      sessionId: string;
      conversationId: string;
      turnNumber: number;
    }
  ): CanonicalMessage[] {
    const anthropicMessages = providerMessages as MessagesAPIMessage[];

    return anthropicMessages.map((msg, index) =>
      this.convertFromMessagesAPIMessage(msg, modelConfig, sessionContext, index)
    );
  }

  /**
   * Convert canonical tools to Anthropic tool format
   *
   * @param tools - Canonical tool definitions
   * @param modelConfig - Model configuration
   * @returns Anthropic tool array
   */
  toProviderTools(
    tools: CanonicalTool[],
    modelConfig: ModelConfig
  ): MessagesAPITool[] {
    // Apply XAI-specific validation if needed
    // XAI has stricter requirements than standard Anthropic API
    const validatedTools = modelConfig.provider === 'xai'
      ? this.validateAndEnhanceToolsForXAI(tools)
      : tools;

    // Gateway has already applied correct naming convention
    // Adapter only handles API format conversion
    return validatedTools.map(tool => this.convertToMessagesAPITool(tool));
  }

  /**
   * Convert provider tools to canonical format
   *
   * @param providerTools - Anthropic tool array
   * @param modelConfig - Model configuration
   * @returns Canonical tool definitions
   */
  fromProviderTools(
    providerTools: unknown[],
    modelConfig: ModelConfig
  ): CanonicalTool[] {
    const anthropicTools = providerTools as MessagesAPITool[];

    return anthropicTools.map(anthropicTool =>
      this.convertFromMessagesAPITool(anthropicTool, modelConfig.provider)
    );
  }

  /**
   * Convert canonical tool use to Anthropic ToolUse
   *
   * @param toolUse - Canonical tool use
   * @param _modelConfig - Model configuration
   * @returns Anthropic ToolUse
   */
  toProviderToolUse(
    toolUse: CanonicalToolUse,
    _modelConfig: ModelConfig
  ): MessagesAPIToolUse {
    return {
      id: toolUse.id,
      type: 'tool_use',
      name: toolUse.name, // Gateway has already applied snake_case
      input: toolUse.input
    };
  }

  /**
   * Convert Anthropic ToolUse to canonical format
   *
   * @param providerToolUse - Anthropic ToolUse
   * @param modelConfig - Model configuration
   * @returns Canonical tool use
   */
  fromProviderToolUse(
    providerToolUse: unknown,
    modelConfig: ModelConfig
  ): CanonicalToolUse {
    const toolUse = providerToolUse as MessagesAPIToolUse;

    // Validate required fields (especially for XAI which can return malformed blocks)
    if (!toolUse.id) {
      throw new Error(`Tool use from ${modelConfig.provider} missing required "id" field`);
    }

    if (!toolUse.name) {
      console.error(`[MessagesAPIAdapter] Tool use from ${modelConfig.provider} missing "name" field:`, toolUse);
      throw new Error(`Tool use ${toolUse.id} from ${modelConfig.provider} missing required "name" field`);
    }

    return {
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input || {},
      metadata: {
        sourceProvider: modelConfig.provider,
        modelId: modelConfig.id
      }
    };
  }

  /**
   * Convert canonical tool result to Anthropic ToolResult
   *
   * @param toolResult - Canonical tool result
   * @param _modelConfig - Model configuration
   * @returns Anthropic ToolResult
   */
  toProviderToolResult(
    toolResult: CanonicalToolResult,
    _modelConfig: ModelConfig
  ): MessagesAPIToolResult {
    // Convert content to string or structured format
    let content: string | Array<{ type: string; text?: string }>;

    if (typeof toolResult.content === 'string') {
      content = toolResult.content;
    } else {
      // Structured data - convert to JSON string
      content = JSON.stringify(toolResult.content, null, 2);
    }

    return {
      type: 'tool_result',
      tool_use_id: toolResult.tool_use_id,
      content: content,
      is_error: toolResult.is_error
    };
  }

  /**
   * Convert Anthropic ToolResult to canonical format
   *
   * @param providerToolResult - Anthropic ToolResult
   * @param _modelConfig - Model configuration
   * @returns Canonical tool result
   */
  fromProviderToolResult(
    providerToolResult: unknown,
    _modelConfig: ModelConfig
  ): CanonicalToolResult {
    const toolResult = providerToolResult as MessagesAPIToolResult;

    // Extract content
    let content: string | object;
    if (typeof toolResult.content === 'string') {
      content = toolResult.content;
    } else if (Array.isArray(toolResult.content)) {
      // Extract text from structured content
      content = toolResult.content
        .map(block => block.text || JSON.stringify(block))
        .join('\n');
    } else {
      content = String(toolResult.content);
    }

    return {
      tool_use_id: toolResult.tool_use_id,
      content: content,
      is_error: toolResult.is_error,
      metadata: {}
    };
  }

  /**
   * Validate tool for Anthropic compatibility
   *
   * @param tool - Canonical tool to validate
   * @param modelConfig - Model configuration
   * @returns Validation result
   */
  validateTool(
    tool: CanonicalTool,
    modelConfig: ModelConfig
  ): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    // Gateway validates naming; adapter validates API format only
    // Tools should already have correct naming when they reach this point

    // Check schema is object type
    if (tool.schema.type !== 'object') {
      errors.push(`Tool schema type must be "object" for Anthropic/XAI`);
    }

    // Check properties exist
    if (!tool.schema.properties) {
      errors.push(`Tool schema must have properties defined`);
    }

    // Description is optional but recommended
    if (!tool.description) {
      console.warn(`Tool "${tool.name}": description is recommended for better model understanding`);
    }

    // Check tool count limit
    const maxTools = this.getMaxTools(modelConfig);
    if (maxTools < Infinity) {
      // This check would be done at the collection level, not individual tool
      // But we document it here for reference
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
   * @returns Max tools (64 for Claude, same for XAI)
   */
  getMaxTools(modelConfig: ModelConfig): number {
    return modelConfig.tools.maxTools;
  }

  /**
   * Check if parallel tool calls are supported
   *
   * @param modelConfig - Model configuration
   * @returns true (Anthropic supports parallel tool calls)
   */
  supportsParallelToolCalls(modelConfig: ModelConfig): boolean {
    return modelConfig.tools.parallelToolCalls;
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Convert canonical tool to Anthropic tool
   */
  private convertToMessagesAPITool(tool: CanonicalTool): MessagesAPITool {
    // Defensive check: ensure schema exists
    if (!tool.schema) {
      throw new Error(`Tool "${tool.name}" is missing required schema property`);
    }

    return {
      name: tool.name, // Gateway has already applied snake_case
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.schema.properties || {},
        required: tool.schema.required || [],
        // Include any additional JSON Schema properties
        ...this.extractAdditionalSchemaProperties(tool.schema)
      }
    };
  }

  /**
   * Convert Anthropic tool to canonical tool
   */
  private convertFromMessagesAPITool(
    anthropicTool: MessagesAPITool,
    provider: string
  ): CanonicalTool {
    const additionalProps = this.extractAdditionalSchemaProperties(anthropicTool.input_schema);

    return {
      name: anthropicTool.name,
      description: anthropicTool.description || '',
      schema: {
        type: 'object',
        properties: (anthropicTool.input_schema.properties || {}) as Record<string, any>,
        required: anthropicTool.input_schema.required,
        // Include any additional JSON Schema properties
        ...additionalProps
      },
      metadata: {
        originalNaming: 'snake_case',
        sourceProvider: provider // 'anthropic' or 'xai'
      }
    };
  }

  /**
   * Extract additional JSON Schema properties
   *
   * @param schema - Schema object
   * @returns Additional properties (excluding type, properties, required)
   */
  private extractAdditionalSchemaProperties(
    schema: Record<string, unknown>
  ): Record<string, unknown> {
    const { type, properties, required, ...additional } = schema;
    return additional;
  }


  /**
   * Convert canonical message to Anthropic message
   */
  private convertToMessagesAPIMessage(msg: CanonicalMessage, modelConfig: ModelConfig): MessagesAPIMessage {
    // Convert content blocks and filter incompatible thinking blocks
    const content: MessagesAPIContentBlock[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case 'text': {
          // #29: forward Anthropic cache_control marker if the upstream
          // middleware set one (Anthropic + XAI Messages API only).
          const textBlock: any = { type: 'text', text: block.text || '' };
          if ((block as any).cache_control) {
            textBlock.cache_control = (block as any).cache_control;
          }
          content.push(textBlock);
          break;
        }

        case 'tool_use':
          if (!block.toolUse) {
            throw new Error('tool_use content block missing toolUse data');
          }
          content.push({
            type: 'tool_use',
            id: block.toolUse.id,
            name: block.toolUse.name, // Gateway has already applied snake_case
            input: block.toolUse.input
          });
          break;

        case 'tool_result':
          if (!block.toolResult) {
            throw new Error('tool_result content block missing toolResult data');
          }
          // Convert content to string if object
          const resultContent = typeof block.toolResult.content === 'string'
            ? block.toolResult.content
            : JSON.stringify(block.toolResult.content);

          content.push({
            type: 'tool_result',
            tool_use_id: block.toolResult.tool_use_id,
            content: resultContent,
            is_error: block.toolResult.is_error
          });
          break;

        case 'thinking':
          // Preserve thinking blocks based on provider support
          // Thinking block types observed in Anthropic-compatible endpoints:
          //   1. Native interleaved (Haiku 4.5): NO signature, always present
          //   2. Extended thinking (Opus + Tab): HAS signature, required for continuations
          //   3. XAI via /v1/messages (e.g. grok-code-fast-1): HAS signature — verified in
          //      session JSONL. Previously stripped here; that broke the XAI prompt cache
          //      (per docs.x.ai multi-turn caching rules: reasoning_content omission is the
          //      top cause of cache misses for reasoning models).
          const thinkingBlock = block as any;

          if (modelConfig.provider === 'anthropic') {
            // #16 / #19 (2026-05-11): Anthropic's Messages API REQUIRES
            // `signature` on every re-sent thinking block, full stop.
            // Empirical: claude-opus-4-6 / claude-sonnet-4-5+ 400 with
            // "messages.X.content.Y.thinking.signature: Field required"
            // whether the original source was 'extended' or 'native'.
            //
            // The earlier "native interleaved is preserved signature-less"
            // policy was based on an older API contract; in current
            // production any signature-less thinking block reaches the
            // server and is rejected. Drop them universally — losing
            // hidden reasoning context is preferable to a hard 400 that
            // stops the whole turn. The APIClient streaming path doesn't
            // set thinkingMetadata.source either, so a source-based gate
            // is unreliable.
            if (thinkingBlock.signature) {
              content.push({
                type: 'thinking',
                thinking: block.thinking || '',
                signature: thinkingBlock.signature,
              });
            }
            // No signature → drop. Anthropic rejects either way.
          } else if (modelConfig.provider === 'xai') {
            // XAI's /v1/messages endpoint tolerates signature-less thinking
            // and uses the content for prompt-cache attribution. Preserve
            // regardless of signature presence.
            content.push({
              type: 'thinking',
              thinking: block.thinking || '',
              ...(thinkingBlock.signature && { signature: thinkingBlock.signature })
            });
          }
          // Skip thinking blocks for providers that don't support them
          break;

        case 'redacted_thinking':
          // XAI grok-4/4.1 encrypted reasoning — pass back opaquely
          // Anthropic Claude also uses redacted_thinking for some content
          if (modelConfig.provider === 'xai' || modelConfig.provider === 'anthropic') {
            content.push({
              type: 'redacted_thinking',
              data: (block as any).data || ''
            });
          }
          break;

        default:
          // For any other types, convert to text
          content.push({ type: 'text', text: JSON.stringify(block) });
          break;
      }
    }

    return {
      role: msg.role as 'user' | 'assistant',
      content: content
    };
  }

  /**
   * Convert Anthropic message to canonical message
   */
  private convertFromMessagesAPIMessage(
    msg: MessagesAPIMessage,
    modelConfig: ModelConfig,
    sessionContext: {
      sessionId: string;
      conversationId: string;
      turnNumber: number;
    },
    index: number
  ): CanonicalMessage {
    // Handle string content (simple text message)
    const contentBlocks: CanonicalContentBlock[] = [];

    if (typeof msg.content === 'string') {
      contentBlocks.push({ type: 'text', text: msg.content });
    } else {
      // Handle content block array
      for (const block of msg.content) {
        if (block.type === 'text' && 'text' in block) {
          contentBlocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use' && 'id' in block && 'name' in block && 'input' in block) {
          // Validate tool_use block has required fields with actual values
          const toolUseBlock = block as any;
          if (!toolUseBlock.id) {
            console.error(`[MessagesAPIAdapter] tool_use block from ${modelConfig.provider} missing id:`, block);
            continue; // Skip malformed block
          }
          if (!toolUseBlock.name) {
            console.error(`[MessagesAPIAdapter] tool_use block from ${modelConfig.provider} has undefined name:`, block);
            console.error(`[MessagesAPIAdapter] Full block details:`, JSON.stringify(block, null, 2));
            continue; // Skip malformed block
          }

          contentBlocks.push({
            type: 'tool_use',
            toolUse: {
              id: toolUseBlock.id,
              name: toolUseBlock.name,
              input: toolUseBlock.input || {}
            }
          });
        } else if (block.type === 'tool_result' && 'tool_use_id' in block) {
          contentBlocks.push({
            type: 'tool_result',
            toolResult: {
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error
            }
          });
        } else if (block.type === 'thinking' && 'thinking' in block) {
          // IMPORTANT: Preserve signature for Claude extended thinking
          // Claude requires signatures to validate thinking blocks in continuations
          const thinkingBlock = block as any;
          // Detect thinking type based on signature presence:
          // - HAS signature = extended thinking (Opus + Tab toggle)
          // - NO signature = native interleaved (Haiku 4.5)
          const thinkingSource = thinkingBlock.signature ? 'extended' : 'native';
          contentBlocks.push({
            type: 'thinking',
            thinking: block.thinking,
            signature: thinkingBlock.signature, // Preserve for Claude continuations
            thinkingMetadata: {
              source: thinkingSource as 'native' | 'extended' | 'mentorship'
            }
          });
        } else if (block.type === 'redacted_thinking' && 'data' in block) {
          // XAI grok-4/4.1 encrypted reasoning traces
          // Preserve opaquely — must be sent back to XAI for context continuity
          contentBlocks.push({
            type: 'redacted_thinking' as any,
            data: (block as any).data,
            thinkingMetadata: {
              source: 'extended' as const
            }
          });
        } else if (block.type === 'server_tool_use' && 'id' in block && 'name' in block) {
          // PTC: Server-side tool use — treat as regular tool_use for execution
          const stBlock = block as any;
          contentBlocks.push({
            type: 'tool_use',
            toolUse: {
              id: stBlock.id,
              name: stBlock.name,
              input: stBlock.input || {}
            }
          });
        } else if (block.type === 'code_execution_tool_result' && 'content' in block) {
          // PTC: Code execution result — surface as text
          const ceBlock = block as any;
          const outputText = ceBlock.output?.stdout || ceBlock.content || '';
          if (outputText) {
            contentBlocks.push({ type: 'text', text: outputText });
          }
        }
      }
    }

    // Determine message type
    let messageType: CanonicalMessage['type'] = 'text';
    if (contentBlocks.some(b => b.type === 'tool_use')) {
      messageType = 'tool_request';
    } else if (contentBlocks.some(b => b.type === 'tool_result')) {
      messageType = 'tool_response';
    } else if (contentBlocks.some(b => b.type === 'thinking')) {
      messageType = 'thinking';
    }

    return {
      uuid: this.generateMessageUuid(),
      timestamp: new Date().toISOString(),
      timeline: {
        sessionId: sessionContext.sessionId,
        conversationId: sessionContext.conversationId,
        turnNumber: sessionContext.turnNumber + index
      },
      role: msg.role,
      type: messageType,
      content: contentBlocks,
      model: {
        id: modelConfig.id,
        provider: modelConfig.provider,
        apiPattern: modelConfig.api.pattern
      }
    };
  }

  /**
   * Generate unique message UUID
   */
  private generateMessageUuid(): string {
    const n: number = Math.random();
    return `msg_${Date.now()}_${n.toString(36).substring(2, 11)}`;
  }

  /**
   * Validate and enhance tools for XAI compatibility
   * XAI has stricter requirements than standard Anthropic API:
   * - description is REQUIRED (not optional)
   * - input_schema.properties is REQUIRED
   * - input_schema.required is REQUIRED (can be empty array)
   * - All properties should have descriptions
   *
   * Based on XAI API documentation and working implementation in Cortex V3
   *
   * @param tools - Canonical tool definitions
   * @returns Enhanced tools with XAI-compliant schemas
   */
  private validateAndEnhanceToolsForXAI(tools: CanonicalTool[]): CanonicalTool[] {
    return tools.map((tool, index) => {
      const enhanced = { ...tool };

      // Ensure name exists
      if (!enhanced.name || typeof enhanced.name !== 'string') {
        console.warn(`[MessagesAPIAdapter] Tool at index ${index} missing name, using default`);
        enhanced.name = `tool_${index}`;
      }

      // Ensure description exists (XAI requires it)
      if (!enhanced.description || typeof enhanced.description !== 'string') {
        enhanced.description = `Execute ${enhanced.name} tool`;
        console.warn(`[MessagesAPIAdapter] Added description for tool: ${enhanced.name}`);
      }

      // Ensure schema exists
      if (!enhanced.schema) {
        enhanced.schema = {
          type: 'object',
          properties: {},
          required: []
        };
        console.warn(`[MessagesAPIAdapter] Created default schema for tool: ${enhanced.name}`);
      }

      // Ensure schema has required fields
      if (!enhanced.schema.type) {
        enhanced.schema.type = 'object';
      }

      if (!enhanced.schema.properties) {
        enhanced.schema.properties = {};
      }

      if (!enhanced.schema.required) {
        enhanced.schema.required = [];
      }

      // Ensure all properties have descriptions (XAI expects this)
      for (const [key, prop] of Object.entries(enhanced.schema.properties)) {
        const property = prop as any;
        if (!property.description || typeof property.description !== 'string') {
          property.description = `Parameter ${key} for ${enhanced.name}`;
          // Only log in debug mode to reduce noise
          if (process.env.DEBUG === 'true') {
            console.log(`[MessagesAPIAdapter] Added description for parameter: ${enhanced.name}.${key}`);
          }
        }
      }

      return enhanced;
    });
  }
}

/**
 * Default singleton instance
 */
export const messagesAPIAdapter = new MessagesAPIAdapter();
