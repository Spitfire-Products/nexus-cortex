/**
 * GoogleGenAPIAdapter
 *
 * Pattern-based adapter for the Google Gen AI (@google/genai) API format.
 * Used by Gemma models and CodeGemma models.
 *
 * API Pattern: google-genai (simplified API)
 * Naming: snake_case
 * Structure: Simplified format with direct content field
 *
 * Phase 1.5: Multi-Provider Architecture
 * Week 3: FREE Helper Models Extension
 *
 * Supported Models (ALL FREE):
 * - Gemma 3 Family: gemma-3-27b-it, gemma-3-12b-it, gemma-3-4b-it, gemma-3-1b-it
 * - Gemma 2 Family: gemma-2-27b-it, gemma-2-9b-it
 * - CodeGemma: codegemma-7b-it (chat), codegemma-7b, codegemma-2b (completion)
 *
 * Function Calling Support:
 * - Gemma 3 27B and 12B officially support function calling
 * - Does NOT produce tool-specific tokens (unlike GPT/Claude)
 * - Frameworks detect calls by matching output structure
 * - Supports Python-style: [function_name(param="value")]
 * - Supports JSON-style: {"name": "function_name", "parameters": {"param": "value"}}
 * - IMPORTANT: Models cannot execute code - validation required
 *
 * Key Differences from GenerateContentAPIAdapter:
 * - Uses @google/genai package (not @google/generative-ai)
 * - Simpler message format (direct content string)
 * - No streaming support in basic API
 * - Function calling via structured output matching (not native tool tokens)
 * - 100% FREE models (zero cost)
 */

import {
  FormatAdapter,
  CanonicalTool,
  CanonicalToolUse,
  CanonicalToolResult,
  CanonicalMessage,
  CanonicalContentBlock,
  PropertySchema
} from './FormatAdapter.interface.js';
import { ModelConfig } from '../models/ModelConfig.interface.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * GoogleGenAI Message Format
 *
 * Simplified message format from @google/genai
 */
export interface GoogleGenAIMessage {
  /** Message role */
  role: 'user' | 'model';

  /** Content as direct string (simpler than generateContent API) */
  content: string;
}

/**
 * GoogleGenAI Tool Format (if tools supported)
 *
 * Note: Basic Gemma models may not support tools, but structure is similar to Gemini
 */
export interface GoogleGenAITool {
  /** Function name */
  name: string;

  /** Description */
  description: string;

  /** Parameters schema */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * GoogleGenAI Response Format
 */
export interface GoogleGenAIResponse {
  /** Generated text */
  text: string;

  /** Usage information (if available) */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * GoogleGenAPIAdapter
 *
 * Adapter for Google's simplified Gen AI API (@google/genai).
 * Primarily used for FREE Gemma models.
 *
 * Features:
 * - Simple message format (string-based content)
 * - FREE model support (gemma-3-27b-it, gemma-2-9b-it)
 * - Zero-cost helper model operations
 * - Automatic token estimation (no actual counts from API)
 */
export class GoogleGenAPIAdapter implements FormatAdapter {
  readonly name = 'GoogleGenAPIAdapter';
  readonly apiPatterns = ['google-genai'];

  /**
   * Convert canonical messages to GoogleGenAI format
   *
   * @param messages - Canonical messages
   * @param modelConfig - Model configuration
   * @returns GoogleGenAI message array
   */
  toProviderMessages(
    messages: CanonicalMessage[],
    _modelConfig: ModelConfig
  ): GoogleGenAIMessage[] {
    return messages
      .filter(msg => msg.role !== 'system') // System messages handled separately
      .map(msg => this.convertToGoogleGenAIMessage(msg));
  }

  /**
   * Convert GoogleGenAI messages to canonical format
   *
   * @param providerMessages - GoogleGenAI messages
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
    const genAIMessages = providerMessages as GoogleGenAIMessage[];

    return genAIMessages.map((message, index) =>
      this.convertFromGoogleGenAIMessage(message, modelConfig, sessionContext, index)
    );
  }

  /**
   * Convert canonical tools to GoogleGenAI format
   *
   * Note: Basic Gemma models may not support tools
   *
   * @param tools - Canonical tool definitions
   * @param _modelConfig - Model configuration
   * @returns GoogleGenAI tool array
   */
  toProviderTools(
    tools: CanonicalTool[],
    _modelConfig: ModelConfig
  ): GoogleGenAITool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: tool.schema.properties,
        required: tool.schema.required || [],
      },
    }));
  }

  /**
   * Convert GoogleGenAI tools to canonical format
   *
   * @param providerTools - GoogleGenAI tools
   * @param _modelConfig - Model configuration
   * @returns Canonical tools
   */
  fromProviderTools(
    providerTools: unknown[],
    _modelConfig: ModelConfig
  ): CanonicalTool[] {
    const genAITools = providerTools as GoogleGenAITool[];

    return genAITools.map(tool => {
      // Convert GoogleGenAI properties to PropertySchema format
      const properties: Record<string, PropertySchema> = {};
      for (const [key, value] of Object.entries(tool.parameters.properties)) {
        const prop = value as any;
        properties[key] = {
          type: prop.type || 'string',
          description: prop.description,
          enum: prop.enum,
          default: prop.default,
          items: prop.items,
        };
      }

      return {
        name: tool.name,
        description: tool.description,
        schema: {
          type: 'object' as const,
          properties,
          required: tool.parameters.required,
        },
        metadata: {
          originalNaming: 'snake_case' as const,
          sourceProvider: 'google-genai',
        },
      };
    });
  }

  /**
   * Convert canonical tool use to GoogleGenAI format
   *
   * Note: May not be supported by basic Gemma models
   *
   * @param toolUse - Canonical tool use
   * @param _modelConfig - Model configuration
   * @returns GoogleGenAI tool call
   */
  toProviderToolUse(
    toolUse: CanonicalToolUse,
    _modelConfig: ModelConfig
  ): unknown {
    return {
      name: toolUse.name,
      args: toolUse.input,
    };
  }

  /**
   * Convert GoogleGenAI tool call to canonical format
   *
   * @param providerToolUse - GoogleGenAI tool call
   * @param _modelConfig - Model configuration
   * @returns Canonical tool use
   */
  fromProviderToolUse(
    providerToolUse: unknown,
    _modelConfig: ModelConfig
  ): CanonicalToolUse {
    const toolCall = providerToolUse as { name: string; args: Record<string, unknown> };

    return {
      // R19a: uuidv4 instead of bare Date.now() — collision-free across
      // concurrent dispatch and same-millisecond bursts.
      id: `call_${uuidv4()}`,
      name: toolCall.name,
      input: toolCall.args,
      metadata: {
        sourceProvider: 'google-genai',
      },
    };
  }

  /**
   * Convert canonical tool result to GoogleGenAI format
   *
   * @param toolResult - Canonical tool result
   * @param _modelConfig - Model configuration
   * @returns GoogleGenAI tool response
   */
  toProviderToolResult(
    toolResult: CanonicalToolResult,
    _modelConfig: ModelConfig
  ): unknown {
    return {
      content: typeof toolResult.content === 'string'
        ? toolResult.content
        : JSON.stringify(toolResult.content),
      isError: toolResult.is_error || false,
    };
  }

  /**
   * Convert GoogleGenAI tool response to canonical format
   *
   * @param providerToolResult - GoogleGenAI tool response
   * @param _modelConfig - Model configuration
   * @returns Canonical tool result
   */
  fromProviderToolResult(
    providerToolResult: unknown,
    _modelConfig: ModelConfig
  ): CanonicalToolResult {
    const toolResponse = providerToolResult as { content: string; isError?: boolean };

    return {
      // R19a: uuidv4 instead of bare Date.now()
      tool_use_id: `call_${uuidv4()}`,
      content: toolResponse.content,
      is_error: toolResponse.isError || false,
      metadata: {
        sourceProvider: 'google-genai',
      },
    };
  }

  /**
   * Validate tool schema for GoogleGenAI
   *
   * @param tool - Tool to validate
   * @param _modelConfig - Model configuration
   * @returns Validation result
   */
  validateTool(
    tool: CanonicalTool,
    _modelConfig: ModelConfig
  ): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!tool.name || tool.name.trim() === '') {
      errors.push('Tool name is required');
    }

    if (!tool.description || tool.description.trim() === '') {
      errors.push('Tool description is required');
    }

    if (!tool.schema || tool.schema.type !== 'object') {
      errors.push('Tool schema must be of type "object"');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Get maximum number of tools supported
   *
   * Note: Gemma models may have limited or no tool support
   *
   * @param _modelConfig - Model configuration
   * @returns Maximum tool count
   */
  getMaxTools(_modelConfig: ModelConfig): number {
    // Conservative limit for Gemma models
    return 64;
  }

  /**
   * Check if parallel tool calls are supported
   *
   * @param _modelConfig - Model configuration
   * @returns false (likely not supported by basic Gemma)
   */
  supportsParallelToolCalls(_modelConfig: ModelConfig): boolean {
    return false; // Gemma models typically don't support parallel tools
  }

  /**
   * Convert canonical message to GoogleGenAI message
   *
   * @param message - Canonical message
   * @returns GoogleGenAI message
   */
  private convertToGoogleGenAIMessage(message: CanonicalMessage): GoogleGenAIMessage {
    // Extract text content from content blocks
    const textContent = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('\n');

    return {
      role: message.role === 'assistant' ? 'model' : 'user',
      content: textContent,
    };
  }

  /**
   * Convert GoogleGenAI message to canonical format
   *
   * @param message - GoogleGenAI message
   * @param modelConfig - Model configuration
   * @param sessionContext - Session context
   * @param index - Message index
   * @returns Canonical message
   */
  private convertFromGoogleGenAIMessage(
    message: GoogleGenAIMessage,
    modelConfig: ModelConfig,
    sessionContext: {
      sessionId: string;
      conversationId: string;
      turnNumber: number;
    },
    index: number
  ): CanonicalMessage {
    const contentBlock: CanonicalContentBlock = {
      type: 'text',
      text: message.content,
    };

    return {
      // R19a: uuidv4 instead of Date.now+index — collision-free
      uuid: `msg_${uuidv4()}`,
      timestamp: new Date().toISOString(),
      timeline: {
        sessionId: sessionContext.sessionId,
        conversationId: sessionContext.conversationId,
        turnNumber: sessionContext.turnNumber + index,
      },
      role: message.role === 'model' ? 'assistant' : 'user',
      type: 'text',
      content: [contentBlock],
      model: {
        id: modelConfig.id,
        provider: modelConfig.provider,
        apiPattern: modelConfig.api.pattern,
      },
      metadata: {
        originalProvider: 'google-genai',
        originalFormat: 'google-genai-message',
      },
    };
  }
}

/**
 * Singleton instance
 */
export const googleGenAPIAdapter = new GoogleGenAPIAdapter();

/**
 * Factory function for creating adapter
 */
export function createGoogleGenAPIAdapter(): GoogleGenAPIAdapter {
  return new GoogleGenAPIAdapter();
}
