/**
 * ChatCompletionsAPIAdapter
 *
 * Pattern-based adapter for the /v1/chat/completions API format.
 *
 * API Pattern: /v1/chat/completions with parameters (nested in function wrapper)
 * Naming: PascalCase (traditional) or snake_case (configurable)
 * Structure: Nested ({ type: "function", function: {...} })
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: SDK_FINDINGS.md
 *
 * Providers using this adapter:
 * - OpenAI (GPT-4, GPT-3.5, GPT-5, etc.)
 * - DeepSeek (accepts both PascalCase and snake_case)
 * - Groq
 * - Perplexity
 * - Mistral
 * - Together AI
 * - Most OpenAI-compatible APIs
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
 * OpenAI ChatCompletionTool Format
 *
 * As defined in openai SDK
 */
export interface OpenAIChatCompletionTool {
  /** Type marker - always "function" */
  type: 'function';

  /** Function definition */
  function: OpenAIFunctionDefinition;
}

/**
 * OpenAI FunctionDefinition
 */
export interface OpenAIFunctionDefinition {
  /** Function name (PascalCase or snake_case, configurable) */
  name: string;

  /** Human-readable description (optional) */
  description?: string;

  /** JSON Schema for parameters - NOTE: property name is "parameters" */
  parameters: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/**
 * OpenAI ToolCall (function call from model)
 */
export interface ChatCompletionsAPIToolCall {
  /** Unique ID */
  id: string;

  /** Type marker - always "function" */
  type: 'function';

  /** Function call details */
  function: {
    /** Function name */
    name: string;

    /** Arguments as JSON string */
    arguments: string;
  };
}

/**
 * OpenAI ToolMessage (function result)
 */
export interface ChatCompletionsAPIToolMessage {
  /** Role - always "tool" */
  role: 'tool';

  /** Content (result as string) */
  content: string;

  /** Tool call ID this is responding to */
  tool_call_id: string;
}

/**
 * OpenAI Chat Message
 *
 * As defined in OpenAI Chat Completions API
 */
export interface OpenAIChatMessage {
  /** Message role */
  role: 'user' | 'assistant' | 'system' | 'tool';

  /** Message content (can be null for assistant messages with tool_calls) */
  content: string | null;

  /** Tool calls (only for assistant role) */
  tool_calls?: ChatCompletionsAPIToolCall[];

  /** Tool call ID (only for tool role) */
  tool_call_id?: string;

  /** Function name (deprecated, only for tool role) */
  name?: string;

  /** Reasoning content for models with CoT (DeepSeek, OpenAI reasoning models) */
  reasoning_content?: string;
}

/**
 * OpenAI Functions Tools Adapter
 *
 * Converts between canonical format and OpenAI's ChatCompletionTool format.
 * Compatible with OpenAI and most OpenAI-compatible APIs.
 */
export class ChatCompletionsAPIAdapter implements FormatAdapter {
  readonly name = 'ChatCompletionsAPIAdapter';
  readonly apiPatterns = ['chat/completions'];

  /**
   * Convert canonical messages to OpenAI chat message format
   *
   * @param messages - Canonical messages
   * @param modelConfig - Model configuration
   * @returns OpenAI chat message array
   */
  toProviderMessages(
    messages: CanonicalMessage[],
    modelConfig: ModelConfig
  ): OpenAIChatMessage[] {
    const openaiMessages: OpenAIChatMessage[] = [];

    for (const msg of messages) {
      // Convert based on message type
      if (msg.role === 'system') {
        // System messages are simple text
        const textContent = msg.content
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('\n');

        openaiMessages.push({
          role: msg.role,
          content: textContent
        });
      } else if (msg.role === 'user') {
        // User messages may contain text or tool results
        const toolResultBlocks = msg.content.filter(b => b.type === 'tool_result');

        if (toolResultBlocks.length > 0) {
          // Convert tool results to separate tool messages
          for (const block of toolResultBlocks) {
            if (!block.toolResult) {
              throw new Error('tool_result block missing toolResult data');
            }
            const toolMessage = this.toProviderToolResult(block.toolResult, modelConfig) as ChatCompletionsAPIToolMessage;
            openaiMessages.push(toolMessage);
          }
        }

        // Also add any text content as a user message
        const textContent = this.stripSystemReminderTags(
          msg.content
            .filter(b => b.type === 'text')
            .map(b => b.text || '')
            .join('\n')
        );

        if (textContent.trim().length > 0) {
          openaiMessages.push({
            role: 'user',
            content: textContent
          });
        }
      } else if (msg.role === 'assistant') {
        // Assistant messages may have tool calls
        const textBlocks = msg.content.filter(b => b.type === 'text');
        const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use');
        const thinkingBlocks = msg.content.filter(b => b.type === 'thinking');

        const content = textBlocks.length > 0
          ? this.stripSystemReminderTags(textBlocks.map(b => b.text || '').join('\n'))
          : null;

        const tool_calls = toolUseBlocks.map(b => {
          if (!b.toolUse) {
            throw new Error('tool_use block missing toolUse data');
          }
          return this.toProviderToolUse(b.toolUse, modelConfig) as ChatCompletionsAPIToolCall;
        });

        // Preserve reasoning_content for DeepSeek and OpenAI reasoning models
        // CRITICAL for DeepSeek V3.2: API returns 400 if reasoning_content not passed back during tool calls
        // CRITICAL for o4-mini: content must not be null when tool_calls is also absent
        // OpenAI requires either content or tool_calls to be set on assistant messages
        const assistantMessage: OpenAIChatMessage = {
          role: 'assistant',
          content: content ?? (tool_calls.length > 0 ? null : ''),
          ...(tool_calls.length > 0 && { tool_calls })
        };

        // Add reasoning_content for models that support it (DeepSeek, OpenAI o-series)
        // DeepSeek REQUIRES reasoning_content on ALL assistant messages during tool calling,
        // even if empty. Without it: 400 "Missing reasoning_content field in the assistant message"
        if (modelConfig.provider === 'deepseek' && modelConfig.reasoning?.supported) {
          const reasoning = thinkingBlocks.map(b => b.thinking || '').join('\n\n');
          assistantMessage.reasoning_content = reasoning || '';
        } else if (thinkingBlocks.length > 0 && modelConfig.provider === 'openai') {
          const reasoning = thinkingBlocks.map(b => b.thinking || '').join('\n\n');
          if (reasoning.trim().length > 0) {
            assistantMessage.reasoning_content = reasoning;
          }
        }

        openaiMessages.push(assistantMessage);

        // Add tool result messages separately
        const toolResultBlocks = msg.content.filter(b => b.type === 'tool_result');
        for (const block of toolResultBlocks) {
          if (!block.toolResult) {
            throw new Error('tool_result block missing toolResult data');
          }
          const toolMessage = this.toProviderToolResult(block.toolResult, modelConfig) as ChatCompletionsAPIToolMessage;
          openaiMessages.push(toolMessage);
        }
      }
    }

    return openaiMessages;
  }

  /**
   * Convert OpenAI messages to canonical format
   *
   * @param providerMessages - OpenAI messages
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
    const openaiMessages = providerMessages as OpenAIChatMessage[];

    return openaiMessages.map((msg, index) =>
      this.convertFromChatCompletionsAPIMessage(msg, modelConfig, sessionContext, index)
    );
  }

  /**
   * Convert canonical tools to OpenAI ChatCompletionTool format
   *
   * @param tools - Canonical tool definitions
   * @param modelConfig - Model configuration
   * @returns OpenAI ChatCompletionTool array
   */
  toProviderTools(
    tools: CanonicalTool[],
    _modelConfig: ModelConfig
  ): OpenAIChatCompletionTool[] {
    // Gateway has already applied correct naming convention
    // Adapter only handles API format conversion
    return tools.map(tool => this.convertToChatCompletionsAPITool(tool));
  }

  /**
   * Convert provider tools to canonical format
   *
   * @param providerTools - OpenAI ChatCompletionTool array
   * @param _modelConfig - Model configuration
   * @returns Canonical tool definitions
   */
  fromProviderTools(
    providerTools: unknown[],
    _modelConfig: ModelConfig
  ): CanonicalTool[] {
    const openaiTools = providerTools as OpenAIChatCompletionTool[];

    return openaiTools.map(openaiTool => this.convertFromChatCompletionsAPITool(openaiTool));
  }

  /**
   * Convert canonical tool use to OpenAI ToolCall
   *
   * @param toolUse - Canonical tool use
   * @param modelConfig - Model configuration
   * @returns OpenAI ToolCall
   */
  toProviderToolUse(
    toolUse: CanonicalToolUse,
    _modelConfig: ModelConfig
  ): ChatCompletionsAPIToolCall {
    // Gateway has already applied correct naming convention
    return {
      id: toolUse.id,
      type: 'function',
      function: {
        name: toolUse.name, // Already has correct naming from gateway
        arguments: JSON.stringify(toolUse.input)
      }
    };
  }

  /**
   * Convert OpenAI ToolCall to canonical format
   *
   * @param providerToolUse - OpenAI ToolCall
   * @param modelConfig - Model configuration
   * @returns Canonical tool use
   */
  fromProviderToolUse(
    providerToolUse: unknown,
    modelConfig: ModelConfig
  ): CanonicalToolUse {
    const toolCall = providerToolUse as ChatCompletionsAPIToolCall;

    // Parse arguments JSON string
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      // Try to extract parameters from XML-formatted arguments
      // Some models (e.g., xAI reasoning models) emit XML parameter tags
      input = this.tryParseXmlArguments(toolCall.function.arguments);
      if (Object.keys(input).length === 0) {
        console.error(`Failed to parse tool arguments: ${toolCall.function.arguments.substring(0, 200)}`);
      }
    }

    // Detect XML-contaminated JSON: JSON.parse succeeds but values contain
    // XML parameter tags from models that mix formats (xAI grok reasoning)
    input = this.sanitizeXmlContaminatedInput(input);

    return {
      id: toolCall.id,
      name: toolCall.function.name,
      input: input,
      metadata: {
        sourceProvider: modelConfig.provider,
        modelId: modelConfig.id
      }
    };
  }

  /**
   * Detect and fix JSON input where XML parameter tags leaked into values.
   * xAI reasoning models sometimes produce JSON like:
   *   {"pattern": "real_value</parameter>\n<parameter name=\"path\">.</parameter>..."}
   * This extracts the actual value before the first </parameter> tag.
   */
  /**
   * Normalize escaped forward slashes in XML tags.
   * xAI reasoning models double-escape: <\/parameter> instead of </parameter>
   */
  private normalizeXmlEscapes(text: string): string {
    return text.replace(/<\\\//g, '</');
  }

  private sanitizeXmlContaminatedInput(
    input: Record<string, unknown>
  ): Record<string, unknown> {
    // Detect XML parameter tags (with or without escaped forward slashes)
    const XML_PARAM_TAG = /<\\?\/parameter>/;
    let contaminated = false;

    for (const value of Object.values(input)) {
      if (typeof value === 'string' && XML_PARAM_TAG.test(value)) {
        contaminated = true;
        break;
      }
    }

    if (!contaminated) return input;

    // Reconstruct the full XML text and normalize escaped slashes
    const fullText = this.normalizeXmlEscapes(
      Object.entries(input)
        .map(([key, val]) => `<parameter name="${key}">${val}`)
        .join('')
    );

    const extracted = this.tryParseXmlArguments(fullText);
    if (Object.keys(extracted).length > 0) {
      console.log(`[ChatCompletionsAPIAdapter] Repaired XML-contaminated tool arguments: ${Object.keys(extracted).join(', ')}`);
      return extracted;
    }

    // Fallback: truncate each value at the first </parameter> or <\/parameter> tag
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && XML_PARAM_TAG.test(value)) {
        cleaned[key] = (value.split(/\\?\/<!/)[0] ?? value).replace(/<\\?\/parameter>.*$/s, '').trim();
      } else {
        cleaned[key] = value;
      }
    }
    console.log(`[ChatCompletionsAPIAdapter] Truncated XML-contaminated tool arguments: ${Object.keys(cleaned).join(', ')}`);
    return cleaned;
  }

  /**
   * Try to parse XML-formatted tool arguments.
   * Handles: <parameter name="key">value</parameter>
   */
  private tryParseXmlArguments(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    // Match <parameter name="key">value</parameter> patterns
    // Values can contain newlines so use [\s\S]*? (non-greedy)
    const paramRegex = /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/g;
    let match;
    while ((match = paramRegex.exec(text)) !== null) {
      const name = match[1];
      const value = match[2];
      if (!name || value === undefined) continue;
      // Try to parse as JSON value (for booleans, numbers)
      try {
        result[name] = JSON.parse(value);
      } catch {
        result[name] = value;
      }
    }
    return result;
  }

  /**
   * Convert canonical tool result to OpenAI ToolMessage
   *
   * @param toolResult - Canonical tool result
   * @param _modelConfig - Model configuration
   * @returns OpenAI ToolMessage
   */
  toProviderToolResult(
    toolResult: CanonicalToolResult,
    _modelConfig: ModelConfig
  ): ChatCompletionsAPIToolMessage {
    // Convert content to string
    let content: string;
    if (typeof toolResult.content === 'string') {
      content = toolResult.content;
    } else {
      content = JSON.stringify(toolResult.content, null, 2);
    }

    // Add error marker if applicable
    if (toolResult.is_error) {
      content = `ERROR: ${content}`;
    }

    return {
      role: 'tool',
      content: content,
      tool_call_id: toolResult.tool_use_id
    };
  }

  /**
   * Convert OpenAI ToolMessage to canonical format
   *
   * @param providerToolResult - OpenAI ToolMessage
   * @param _modelConfig - Model configuration
   * @returns Canonical tool result
   */
  fromProviderToolResult(
    providerToolResult: unknown,
    _modelConfig: ModelConfig
  ): CanonicalToolResult {
    const toolMessage = providerToolResult as ChatCompletionsAPIToolMessage;

    // Check if this is an error (basic heuristic)
    const is_error = toolMessage.content.startsWith('ERROR:');
    const content = is_error
      ? toolMessage.content.replace(/^ERROR:\s*/, '')
      : toolMessage.content;

    return {
      tool_use_id: toolMessage.tool_call_id,
      content: content,
      is_error: is_error,
      metadata: {}
    };
  }

  /**
   * Validate tool for OpenAI compatibility
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
      errors.push(`Tool schema type must be "object" for OpenAI`);
    }

    // Check properties exist
    if (!tool.schema.properties) {
      errors.push(`Tool schema must have properties defined`);
    }

    // Description is optional
    if (!tool.description) {
      console.warn(`Tool "${tool.name}": description is recommended for better model understanding`);
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
   * @returns Max tools (128 for GPT-4, varies by provider)
   */
  getMaxTools(modelConfig: ModelConfig): number {
    return modelConfig.tools.maxTools;
  }

  /**
   * Check if parallel tool calls are supported
   *
   * @param modelConfig - Model configuration
   * @returns true (OpenAI supports parallel tool calls)
   */
  supportsParallelToolCalls(modelConfig: ModelConfig): boolean {
    return modelConfig.tools.parallelToolCalls;
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Strip <system-reminder> XML tags from text content while preserving inner text.
   *
   * Mentorship guidance is injected as <system-reminder>...</system-reminder> wrapped text
   * in assistant messages (see CortexOrchestrator.injectThinkingBlock). These tags are
   * meaningful for APIs that extract them (Responses API), but Chat Completions models
   * see them as raw text and reproduce them verbatim as gibberish in their output.
   */
  private stripSystemReminderTags(text: string): string {
    return text
      .replace(/<system-reminder>\n?/g, '')
      .replace(/\n?<\/system-reminder>/g, '');
  }

  /**
   * Convert canonical tool to OpenAI ChatCompletionTool
   */
  private convertToChatCompletionsAPITool(
    tool: CanonicalTool
  ): OpenAIChatCompletionTool {
    // Gateway has already applied correct naming convention
    return {
      type: 'function',
      function: {
        name: tool.name, // Already has correct naming from gateway
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.schema.properties,
          required: tool.schema.required,
          // Include any additional JSON Schema properties
          ...this.extractAdditionalSchemaProperties(tool.schema)
        }
      }
    };
  }

  /**
   * Convert OpenAI ChatCompletionTool to canonical tool
   */
  private convertFromChatCompletionsAPITool(openaiTool: OpenAIChatCompletionTool): CanonicalTool {
    const func = openaiTool.function;
    const additionalProps = this.extractAdditionalSchemaProperties(func.parameters);

    return {
      name: func.name,
      description: func.description || '',
      schema: {
        type: 'object',
        properties: (func.parameters.properties || {}) as Record<string, any>,
        required: func.parameters.required,
        // Include any additional JSON Schema properties
        ...additionalProps
      },
      metadata: {
        originalName: func.name, // Store original name as-is
        sourceProvider: 'openai-compatible'
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
   * Convert OpenAI message to canonical message
   */
  private convertFromChatCompletionsAPIMessage(
    msg: OpenAIChatMessage,
    modelConfig: ModelConfig,
    sessionContext: {
      sessionId: string;
      conversationId: string;
      turnNumber: number;
    },
    index: number
  ): CanonicalMessage {
    const contentBlocks: CanonicalContentBlock[] = [];

    // Handle reasoning_content for DeepSeek and OpenAI reasoning models
    // Extract BEFORE text content so thinking appears first
    if (msg.role === 'assistant' && msg.reasoning_content) {
      contentBlocks.push({
        type: 'thinking',
        thinking: msg.reasoning_content,
        thinkingMetadata: {
          source: 'native', // Native interleaved reasoning from the model
          modelId: modelConfig.id
        }
      });
    }

    // Handle tool role messages as tool results (do this FIRST, before text)
    if (msg.role === 'tool' && msg.tool_call_id) {
      contentBlocks.push({
        type: 'tool_result',
        toolResult: {
          tool_use_id: msg.tool_call_id,
          content: msg.content || '',
          is_error: msg.content?.startsWith('ERROR:') || false
        }
      });
    } else {
      // Add text content if present (but NOT for tool messages)
      if (msg.content && typeof msg.content === 'string') {
        contentBlocks.push({ type: 'text', text: msg.content });
      }
    }

    // Add tool calls for assistant messages
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        const canonicalToolUse = this.fromProviderToolUse(toolCall, modelConfig);
        contentBlocks.push({
          type: 'tool_use',
          toolUse: canonicalToolUse
        });
      }
    }

    // Determine message type
    let messageType: CanonicalMessage['type'] = 'text';
    if (contentBlocks.some(b => b.type === 'tool_use')) {
      messageType = 'tool_request';
    } else if (contentBlocks.some(b => b.type === 'tool_result')) {
      messageType = 'tool_response';
    }

    return {
      uuid: this.generateMessageUuid(),
      timestamp: new Date().toISOString(),
      timeline: {
        sessionId: sessionContext.sessionId,
        conversationId: sessionContext.conversationId,
        turnNumber: sessionContext.turnNumber + index
      },
      role: msg.role === 'tool' ? 'user' : msg.role, // Convert tool role to user
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
}

/**
 * Default singleton instance
 */
export const chatCompletionsAPIAdapter = new ChatCompletionsAPIAdapter();
