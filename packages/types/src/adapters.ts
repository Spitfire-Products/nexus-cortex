/**
 * Adapter Interface Type Definitions
 *
 * @packageDocumentation
 * @module @nexus-cortex/types/adapters
 *
 * This module contains adapter interface types for the Nexus Cortex system.
 * These are contract definitions for bidirectional conversion between canonical
 * and provider-specific formats.
 *
 * Phase 1.5: Multi-Provider Architecture
 */

import type { CanonicalTool, CanonicalToolUse, CanonicalToolResult } from './tools';
import type { CanonicalMessage } from './messages';
import type { ModelConfig } from './models';

/**
 * FormatAdapter Interface
 *
 * Bidirectional conversion between canonical and provider-specific formats.
 *
 * Each adapter handles one API pattern:
 * - GeminiGenerativeAIToolsAdapter: parametersJsonSchema, snake_case
 * - AnthropicMessagesToolsAdapter: input_schema, snake_case
 * - OpenAIFunctionsToolsAdapter: parameters, PascalCase/snake_case
 */
export interface FormatAdapter {
  /**
   * Adapter name (matches ModelConfig.tools.adapter)
   */
  readonly name: string;

  /**
   * API patterns this adapter supports
   */
  readonly apiPatterns: string[];

  /**
   * Convert canonical messages to provider-specific format
   *
   * @param messages - Canonical messages
   * @param modelConfig - Model configuration
   * @returns Provider-specific message format
   */
  toProviderMessages(
    messages: CanonicalMessage[],
    modelConfig: ModelConfig
  ): unknown[];

  /**
   * Convert provider-specific messages to canonical format
   *
   * @param providerMessages - Provider-specific messages
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
  ): CanonicalMessage[];

  /**
   * Convert canonical tools to provider-specific format
   *
   * @param tools - Canonical tool definitions
   * @param modelConfig - Model configuration (for naming convention, etc.)
   * @returns Provider-specific tool format
   */
  toProviderTools(
    tools: CanonicalTool[],
    modelConfig: ModelConfig
  ): unknown[];

  /**
   * Convert provider-specific tools to canonical format
   *
   * @param providerTools - Provider-specific tool definitions
   * @param modelConfig - Model configuration
   * @returns Canonical tool definitions
   */
  fromProviderTools(
    providerTools: unknown[],
    modelConfig: ModelConfig
  ): CanonicalTool[];

  /**
   * Convert canonical tool use to provider-specific format
   *
   * @param toolUse - Canonical tool use
   * @param modelConfig - Model configuration
   * @returns Provider-specific tool use format
   */
  toProviderToolUse(
    toolUse: CanonicalToolUse,
    modelConfig: ModelConfig
  ): unknown;

  /**
   * Convert provider-specific tool use to canonical format
   *
   * @param providerToolUse - Provider-specific tool use
   * @param modelConfig - Model configuration
   * @returns Canonical tool use
   */
  fromProviderToolUse(
    providerToolUse: unknown,
    modelConfig: ModelConfig
  ): CanonicalToolUse;

  /**
   * Convert canonical tool result to provider-specific format
   *
   * @param toolResult - Canonical tool result
   * @param modelConfig - Model configuration
   * @returns Provider-specific tool result format
   */
  toProviderToolResult(
    toolResult: CanonicalToolResult,
    modelConfig: ModelConfig
  ): unknown;

  /**
   * Convert provider-specific tool result to canonical format
   *
   * @param providerToolResult - Provider-specific tool result
   * @param modelConfig - Model configuration
   * @returns Canonical tool result
   */
  fromProviderToolResult(
    providerToolResult: unknown,
    modelConfig: ModelConfig
  ): CanonicalToolResult;

  /**
   * Validate tool schema for this adapter
   *
   * @param tool - Tool to validate
   * @param modelConfig - Model configuration
   * @returns Validation result with errors if invalid
   */
  validateTool(
    tool: CanonicalTool,
    modelConfig: ModelConfig
  ): {
    valid: boolean;
    errors?: string[];
  };

  /**
   * Get maximum number of tools supported
   *
   * @param modelConfig - Model configuration
   * @returns Maximum tool count (or Infinity if unlimited)
   */
  getMaxTools(modelConfig: ModelConfig): number;

  /**
   * Check if parallel tool calls are supported
   *
   * @param modelConfig - Model configuration
   * @returns true if parallel tool calls supported
   */
  supportsParallelToolCalls(modelConfig: ModelConfig): boolean;
}

/**
 * Adapter Registry Interface
 *
 * Registry for managing format adapters.
 */
export interface AdapterRegistry {
  /**
   * Register a format adapter
   *
   * @param adapter - The adapter to register
   */
  registerAdapter(adapter: FormatAdapter): void;

  /**
   * Get an adapter by name
   *
   * @param adapterName - Adapter name
   * @returns The adapter
   * @throws Error if adapter not found
   */
  getAdapter(adapterName: string): FormatAdapter;

  /**
   * Get adapter for model
   *
   * @param modelConfig - Model configuration
   * @returns Adapter implementation
   * @throws Error if adapter not found
   */
  getAdapterForModel(modelConfig: ModelConfig): FormatAdapter;

  /**
   * Check if an adapter is registered
   *
   * @param adapterName - Adapter name
   * @returns true if the adapter is registered
   */
  hasAdapter(adapterName: string): boolean;

  /**
   * List all registered adapter names
   *
   * @returns Array of adapter names
   */
  listAdapters(): string[];
}