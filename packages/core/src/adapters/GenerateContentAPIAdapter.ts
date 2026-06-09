/**
 * GenerateContentAPIAdapter
 *
 * Pattern-based adapter for the generateContent API format used by Google Gemini/Vertex AI.
 *
 * API Pattern: generateContent with parametersJsonSchema
 * Naming: snake_case
 * Structure: Flat (no wrapper)
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: SDK_FINDINGS.md, GEMINI_TOOL_FORMAT_REFERENCE.md
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
import { v4 as uuidv4 } from 'uuid';

/**
 * Gemini FunctionDeclaration Format
 *
 * As defined in @google/generative-ai SDK
 */
export interface GenerateContentFunctionDeclaration {
  /** Function name (snake_case) */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for parameters - REST API uses "parameters" while SDK uses "parametersJsonSchema" */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/**
 * Gemini FunctionCall (tool use from model)
 */
export interface GenerateContentFunctionCall {
  /** Function name */
  name: string;

  /** Arguments as key-value pairs */
  args: Record<string, unknown>;

  /**
   * Thought signature for preserving reasoning context across multi-turn function calling
   * Required for Gemini 2.5+/3+ models in multi-step tool execution
   * Must be passed back exactly as received
   */
  thoughtSignature?: string;
}

/**
 * Gemini FunctionResponse (tool result)
 */
export interface GenerateContentFunctionResponse {
  /** Function name */
  name: string;

  /** Response content */
  response: {
    /** Result data */
    content?: unknown;

    /** Error information */
    error?: string;
  };
}

/**
 * Gemini Part (content part in a message)
 */
export type GeminiPart =
  | { text: string; thought?: boolean }  // thought flag for extended thinking
  | { functionCall: GenerateContentFunctionCall; thoughtSignature?: string }  // thoughtSignature for function calling context
  | { functionResponse: GenerateContentFunctionResponse };

/**
 * Gemini Content (message in conversation)
 *
 * As defined in @google/generative-ai SDK
 */
export interface GenerateContentMessage {
  /** Message role */
  role: 'user' | 'model';

  /** Content parts */
  parts: GeminiPart[];
}

/**
 * Gemini GenerativeAI Tools Adapter
 *
 * Converts between canonical format and Gemini's FunctionDeclaration format.
 */
export class GenerateContentAPIAdapter implements FormatAdapter {
  readonly name = 'GenerateContentAPIAdapter';
  readonly apiPatterns = ['generateContent'];

  /**
   * Convert canonical messages to Gemini Content format
   *
   * @param messages - Canonical messages
   * @param modelConfig - Model configuration
   * @returns Gemini Content array
   */
  toProviderMessages(
    messages: CanonicalMessage[],
    _modelConfig: ModelConfig
  ): GenerateContentMessage[] {
    return messages
      .filter(msg => msg.role !== 'system') // System messages handled separately
      .map(msg => this.convertToGenerateContentMessage(msg));
  }

  /**
   * Convert Gemini Content to canonical format
   *
   * @param providerMessages - Gemini Content array
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
    const geminiContents = providerMessages as GenerateContentMessage[];

    return geminiContents.map((content, index) =>
      this.convertFromGenerateContentMessage(content, modelConfig, sessionContext, index)
    );
  }

  /**
   * Convert canonical tools to Gemini FunctionDeclaration format
   *
   * @param tools - Canonical tool definitions
   * @param modelConfig - Model configuration
   * @returns Gemini FunctionDeclaration array
   */
  toProviderTools(
    tools: CanonicalTool[],
    _modelConfig: ModelConfig
  ): GenerateContentFunctionDeclaration[] {
    // Gateway has already applied correct naming convention
    // Adapter only handles API format conversion
    return tools.map(tool => this.convertToGeminiTool(tool));
  }

  /**
   * Convert provider tools to canonical format
   *
   * @param providerTools - Gemini FunctionDeclaration array
   * @param modelConfig - Model configuration
   * @returns Canonical tool definitions
   */
  fromProviderTools(
    providerTools: unknown[],
    _modelConfig: ModelConfig
  ): CanonicalTool[] {
    const geminiTools = providerTools as GenerateContentFunctionDeclaration[];

    return geminiTools.map(geminiTool => this.convertFromGeminiTool(geminiTool));
  }

  /**
   * Convert canonical tool use to Gemini FunctionCall
   *
   * @param toolUse - Canonical tool use
   * @param _modelConfig - Model configuration
   * @returns Gemini FunctionCall
   */
  toProviderToolUse(
    toolUse: CanonicalToolUse,
    _modelConfig: ModelConfig
  ): GenerateContentFunctionCall {
    return {
      name: toolUse.name, // Gateway has already applied snake_case
      args: toolUse.input
    };
  }

  /**
   * Convert Gemini FunctionCall to canonical format
   *
   * @param providerToolUse - Gemini FunctionCall
   * @param modelConfig - Model configuration
   * @returns Canonical tool use
   */
  fromProviderToolUse(
    providerToolUse: unknown,
    modelConfig: ModelConfig
  ): CanonicalToolUse {
    const functionCall = providerToolUse as GenerateContentFunctionCall;

    return {
      id: this.generateToolUseId(),
      name: functionCall.name,
      input: functionCall.args,
      metadata: {
        sourceProvider: 'google',
        modelId: modelConfig.id,
        // Preserve thought signature for Gemini 2.5+/3+ multi-turn function calling
        thoughtSignature: functionCall.thoughtSignature
      }
    };
  }

  /**
   * Convert canonical tool result to Gemini FunctionResponse
   *
   * @param toolResult - Canonical tool result
   * @param _modelConfig - Model configuration
   * @returns Gemini FunctionResponse
   */
  toProviderToolResult(
    toolResult: CanonicalToolResult,
    _modelConfig: ModelConfig
  ): GenerateContentFunctionResponse {
    // We need the function name, which isn't in CanonicalToolResult
    // This is a limitation - we'll need to track tool_use_id -> name mapping
    // For now, we'll extract it from metadata if available

    const functionName = (toolResult.metadata as any)?.functionName || 'unknown';

    return {
      name: functionName,
      response: toolResult.is_error
        ? { error: String(toolResult.content) }
        : { content: toolResult.content }
    };
  }

  /**
   * Convert Gemini FunctionResponse to canonical format
   *
   * @param providerToolResult - Gemini FunctionResponse
   * @param _modelConfig - Model configuration
   * @returns Canonical tool result
   */
  fromProviderToolResult(
    providerToolResult: unknown,
    _modelConfig: ModelConfig
  ): CanonicalToolResult {
    const functionResponse = providerToolResult as GenerateContentFunctionResponse;

    const hasError = 'error' in functionResponse.response;

    let content: string | object;
    if (hasError) {
      content = String(functionResponse.response.error);
    } else {
      content = functionResponse.response.content as string | object || '';
    }

    return {
      tool_use_id: '', // Will need to be filled in by caller
      content: content,
      is_error: hasError,
      metadata: {
        functionName: functionResponse.name
      }
    };
  }

  /**
   * Validate tool for Gemini compatibility
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
      errors.push(`Tool schema type must be "object" for Gemini`);
    }

    // Check properties exist
    if (!tool.schema.properties) {
      errors.push(`Tool schema must have properties defined`);
    }

    // Check description exists
    if (!tool.description || tool.description.trim().length === 0) {
      errors.push(`Tool description is required for Gemini`);
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
   * @returns Max tools (effectively unlimited for Gemini)
   */
  getMaxTools(modelConfig: ModelConfig): number {
    return modelConfig.tools.maxTools;
  }

  /**
   * Check if parallel tool calls are supported
   *
   * @param modelConfig - Model configuration
   * @returns false (Gemini doesn't support parallel tool calls)
   */
  supportsParallelToolCalls(modelConfig: ModelConfig): boolean {
    return modelConfig.tools.parallelToolCalls;
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Convert canonical tool to Gemini FunctionDeclaration
   */
  private convertToGeminiTool(tool: CanonicalTool): GenerateContentFunctionDeclaration {
    // Sanitize properties to remove fields Gemini doesn't support
    const sanitizedProperties = this.sanitizePropertiesForGemini(tool.schema.properties);

    return {
      name: tool.name, // Gateway has already applied snake_case
      description: tool.description,
      parameters: {
        type: 'object',
        properties: sanitizedProperties,
        required: tool.schema.required
        // Note: extractAdditionalSchemaProperties would include fields like
        // additionalProperties which Gemini rejects, so we don't include them
      }
    };
  }

  /**
   * Convert Gemini FunctionDeclaration to canonical tool
   */
  private convertFromGeminiTool(geminiTool: GenerateContentFunctionDeclaration): CanonicalTool {
    const additionalProps = this.extractAdditionalSchemaProperties(geminiTool.parameters);

    return {
      name: geminiTool.name,
      description: geminiTool.description,
      schema: {
        type: 'object',
        properties: geminiTool.parameters.properties as Record<string, any>,
        required: geminiTool.parameters.required,
        // Include any additional JSON Schema properties
        ...additionalProps
      },
      metadata: {
        originalName: geminiTool.name, // Store original name as-is
        sourceProvider: 'google'
      }
    };
  }

  /**
   * Sanitize schema properties for Gemini compatibility
   *
   * Gemini's REST API doesn't support certain JSON Schema fields like:
   * - additionalProperties
   * - $schema, $id, $ref
   * - Some complex validation keywords
   *
   * This recursively cleans nested properties.
   */
  private sanitizePropertiesForGemini(properties: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(properties)) {
      if (typeof value !== 'object' || value === null) {
        sanitized[key] = value;
        continue;
      }

      const sanitizedProp: Record<string, any> = {};

      for (const [propKey, propValue] of Object.entries(value)) {
        // Skip fields Gemini doesn't support
        if (propKey === 'additionalProperties' ||
            propKey === '$schema' ||
            propKey === '$id' ||
            propKey === '$ref') {
          continue;
        }

        // Recursively sanitize nested properties
        if (propKey === 'properties' && typeof propValue === 'object' && propValue !== null) {
          sanitizedProp[propKey] = this.sanitizePropertiesForGemini(propValue as Record<string, any>);
        }
        // Recursively sanitize items schema (for arrays)
        else if (propKey === 'items' && typeof propValue === 'object' && propValue !== null) {
          sanitizedProp[propKey] = this.sanitizeSchemaObject(propValue as Record<string, any>);
        }
        else {
          sanitizedProp[propKey] = propValue;
        }
      }

      sanitized[key] = sanitizedProp;
    }

    return sanitized;
  }

  /**
   * Sanitize a single schema object (for items, etc.)
   */
  private sanitizeSchemaObject(schema: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(schema)) {
      // Skip unsupported fields
      if (key === 'additionalProperties' ||
          key === '$schema' ||
          key === '$id' ||
          key === '$ref') {
        continue;
      }

      // Recursively handle nested properties
      if (key === 'properties' && typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizePropertiesForGemini(value as Record<string, any>);
      }
      // Recursively handle items
      else if (key === 'items' && typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeSchemaObject(value as Record<string, any>);
      }
      else {
        sanitized[key] = value;
      }
    }

    return sanitized;
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
   * Generate unique tool use ID
   *
   * @returns Unique ID
   */
  private generateToolUseId(): string {
    // R19a: uuidv4 instead of Date.now()+Math.random — collision-free even
    // under concurrent dispatch or same-millisecond bursts. Same reasoning
    // as R6's synthetic_repair_ uuid fix in CortexOrchestrator.
    return `toolu_${uuidv4()}`;
  }

  /**
   * Convert canonical message to Gemini Content
   */
  private convertToGenerateContentMessage(msg: CanonicalMessage): GenerateContentMessage {
    const parts: GeminiPart[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          parts.push({ text: block.text || '' });
          break;

        case 'tool_use':
          if (!block.toolUse) {
            throw new Error('tool_use content block missing toolUse data');
          }

          // Build function call part
          const functionCallPart: any = {
            functionCall: {
              name: block.toolUse.name, // Gateway has already applied snake_case
              args: block.toolUse.input
            }
          };

          // Restore thought signature if present (required for Gemini 2.5+/3+ multi-turn function calling)
          const thoughtSig = block.toolUse.metadata?.thoughtSignature as string | undefined;
          if (thoughtSig) {
            functionCallPart.thoughtSignature = thoughtSig;
          }

          parts.push(functionCallPart);
          break;

        case 'tool_result':
          if (!block.toolResult) {
            throw new Error('tool_result content block missing toolResult data');
          }
          // Extract function name from metadata (Gemini requires it)
          const functionName = (block.toolResult.metadata as any)?.functionName || 'unknown';

          parts.push({
            functionResponse: {
              name: functionName,
              response: block.toolResult.is_error
                ? { error: String(block.toolResult.content) }
                : { content: block.toolResult.content }
            }
          });
          break;

        case 'thinking':
          // R20d: silently drop thinking blocks when serializing to Gemini.
          // Previously stringified as `[Thinking: ...]` text, which Gemini
          // would then parrot back in its response (cross-provider session
          // swap: Anthropic emits thinking, request hits Gemini, model echoes
          // the [Thinking: ...] string verbatim — caught by parallel benchmark
          // 2026-05-13). Gemini's own thinking lives in part.thought + part.text
          // and is filtered at parse-time anyway; foreign thinking carries no
          // useful prompt signal for Gemini.
          break;
      }
    }

    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts
    };
  }

  /**
   * Convert Gemini Content to canonical message
   */
  private convertFromGenerateContentMessage(
    content: GenerateContentMessage,
    modelConfig: ModelConfig,
    sessionContext: {
      sessionId: string;
      conversationId: string;
      turnNumber: number;
    },
    index: number
  ): CanonicalMessage {
    const contentBlocks: CanonicalContentBlock[] = [];

    // Handle final chunk which may not have parts (just role)
    if (!content.parts || !Array.isArray(content.parts)) {
      // Return empty message for end-of-stream markers
      return {
        uuid: this.generateMessageUuid(),
        timestamp: new Date().toISOString(),
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: sessionContext.turnNumber + index
        },
        role: content.role === 'model' ? 'assistant' : 'user',
        type: 'text',
        content: [],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };
    }

    for (const part of content.parts) {
      if ('text' in part) {
        contentBlocks.push({ type: 'text', text: part.text });
      } else if ('functionCall' in part) {
        // #23 (2026-05-11): preserve thoughtSignature on the message-level
        // converter. Per-block converter (fromProviderToolUse) does this
        // already; the message-level path previously dropped it, breaking
        // Gemini 2.5+/3 multi-turn reasoning continuity. Round-14 adapter-
        // round-trip audit caught the asymmetry.
        const thoughtSignature = (part as any).thoughtSignature as string | undefined;
        contentBlocks.push({
          type: 'tool_use',
          toolUse: {
            id: this.generateToolUseId(),
            name: part.functionCall.name,
            input: part.functionCall.args,
            ...(thoughtSignature ? { metadata: { thoughtSignature } } : {}),
          }
        });
      } else if ('functionResponse' in part) {
        const hasError = 'error' in part.functionResponse.response;
        const resultContent: string | object = hasError
          ? String(part.functionResponse.response.error)
          : (part.functionResponse.response.content as string | object || '');

        contentBlocks.push({
          type: 'tool_result',
          toolResult: {
            tool_use_id: '', // Will need to be filled by caller
            content: resultContent,
            is_error: hasError,
            metadata: {
              functionName: part.functionResponse.name
            }
          }
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
      role: content.role === 'model' ? 'assistant' : 'user',
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
    // R19a: see generateToolUseId comment
    return `msg_${uuidv4()}`;
  }
}

/**
 * Default singleton instance
 */
export const generateContentAPIAdapter = new GenerateContentAPIAdapter();
