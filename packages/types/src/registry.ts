/**
 * Registry Interface Type Definitions
 *
 * @packageDocumentation
 * @module @nexus-cortex/types/registry
 *
 * This module contains registry interface types for the Nexus Cortex system.
 * These interfaces define contracts for managing tools and their implementations.
 */

import type { CanonicalTool, ToolSchema, CanonicalToolResult } from './tools';

/**
 * Tool Implementation
 *
 * The actual implementation of a tool that can be executed.
 */
export interface ToolImplementation {
  /** Tool name */
  name: string;

  /** Tool description */
  description: string;

  /** Tool schema */
  schema: ToolSchema;

  /**
   * Execute the tool with given arguments
   *
   * @param args - Tool arguments
   * @returns Tool execution result
   */
  execute(args: Record<string, unknown>): Promise<CanonicalToolResult> | CanonicalToolResult;

  /** Whether the tool is available (optional, defaults to true) */
  isAvailable?: () => boolean | Promise<boolean>;

  /** Tool metadata */
  metadata?: {
    /** Tool category */
    category?: string;

    /** Tool version */
    version?: string;

    /** Whether tool is deprecated */
    deprecated?: boolean;

    /** Replacement tool name (if deprecated) */
    replacement?: string;

    /** Additional metadata */
    [key: string]: unknown;
  };
}

/**
 * Tool Factory Interface
 *
 * Factory for creating tool instances with dependency injection.
 */
export interface ToolFactoryInterface {
  /**
   * Create a tool instance
   *
   * @param name - Tool name
   * @param dependencies - Tool dependencies
   * @returns Tool implementation
   */
  createTool(
    name: string,
    dependencies?: Record<string, unknown>
  ): ToolImplementation | Promise<ToolImplementation>;

  /**
   * Check if factory can create a specific tool
   *
   * @param name - Tool name
   * @returns true if the factory can create this tool
   */
  canCreate(name: string): boolean;

  /**
   * List tools this factory can create
   *
   * @returns Array of tool names
   */
  listTools(): string[];
}

/**
 * Tool Registry Interface (Read-Only)
 *
 * Read-only interface for accessing registered tools.
 */
export interface ToolRegistry {
  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns Tool implementation or undefined if not found
   */
  getTool(name: string): ToolImplementation | undefined;

  /**
   * Get tool definition (without implementation)
   *
   * @param name - Tool name
   * @returns Canonical tool definition
   */
  getToolDefinition(name: string): CanonicalTool | undefined;

  /**
   * List all registered tool names
   *
   * @returns Array of tool names
   */
  listTools(): string[];

  /**
   * List tools by category
   *
   * @param category - Tool category
   * @returns Array of tool names in the category
   */
  listToolsByCategory(category: string): string[];

  /**
   * Check if a tool is registered
   *
   * @param name - Tool name
   * @returns true if the tool is registered
   */
  hasTool(name: string): boolean;

  /**
   * Get all tool definitions (for sending to AI models)
   *
   * @param filter - Optional filter function
   * @returns Array of canonical tool definitions
   */
  getAllDefinitions(
    filter?: (tool: CanonicalTool) => boolean
  ): CanonicalTool[];

  /**
   * Get tools that are currently available
   *
   * @returns Array of available tool names
   */
  getAvailableTools(): Promise<string[]>;
}

/**
 * Mutable Tool Registry Interface
 *
 * Extends ToolRegistry with mutation methods for registering/unregistering tools.
 */
export interface MutableToolRegistry extends ToolRegistry {
  /**
   * Register a tool implementation
   *
   * @param tool - Tool implementation to register
   */
  registerTool(tool: ToolImplementation): void;

  /**
   * Register multiple tools at once
   *
   * @param tools - Array of tool implementations
   */
  registerTools(tools: ToolImplementation[]): void;

  /**
   * Register a tool factory
   *
   * @param factory - Tool factory to register
   */
  registerFactory(factory: ToolFactoryInterface): void;

  /**
   * Unregister a tool by name
   *
   * @param name - Tool name to unregister
   * @returns true if the tool was unregistered
   */
  unregisterTool(name: string): boolean;

  /**
   * Clear all registered tools
   */
  clear(): void;

  /**
   * Enable or disable a tool
   *
   * @param name - Tool name
   * @param enabled - Whether to enable or disable
   */
  setToolEnabled(name: string, enabled: boolean): void;

  /**
   * Set tool metadata
   *
   * @param name - Tool name
   * @param metadata - Metadata to set
   */
  setToolMetadata(name: string, metadata: Record<string, unknown>): void;
}

/**
 * Tool Discovery Interface
 *
 * Interface for discovering tools dynamically (e.g., from MCP servers).
 */
export interface ToolDiscovery {
  /**
   * Discover available tools
   *
   * @returns Array of discovered tool implementations
   */
  discoverTools(): Promise<ToolImplementation[]>;

  /**
   * Subscribe to tool changes
   *
   * @param callback - Callback for tool changes
   * @returns Unsubscribe function
   */
  onToolsChanged(
    callback: (event: ToolChangeEvent) => void
  ): () => void;
}

/**
 * Tool Change Event
 *
 * Event emitted when tools are added, removed, or updated.
 */
export interface ToolChangeEvent {
  /** Event type */
  type: 'added' | 'removed' | 'updated';

  /** Tool names affected */
  tools: string[];

  /** Event timestamp */
  timestamp: string;

  /** Event source (e.g., 'mcp', 'manual', 'factory') */
  source?: string;
}

/**
 * Tool Execution Context
 *
 * Context provided to tools during execution.
 */
export interface ToolExecutionContext {
  /** Session ID */
  sessionId: string;

  /** Conversation ID */
  conversationId: string;

  /** Current model */
  modelId: string;

  /** User ID (if available) */
  userId?: string;

  /** Project path */
  projectPath?: string;

  /** Additional context */
  [key: string]: unknown;
}

/**
 * Configuration for tool execution
 * (Moved from executors to break circular dependency)
 */
export interface ExecutorConfig {
  /** Working directory for file operations */
  workingDirectory: string;

  /** Maximum execution time per tool (milliseconds) */
  maxExecutionTime?: number;

  /** Whether to allow network access */
  allowNetwork?: boolean;

  /** Whether to allow file system access */
  allowFileSystem?: boolean;

  /** Whether to allow shell command execution */
  allowShellExecution?: boolean;

  /** Additional tool-specific configuration */
  [key: string]: any;
}

/**
 * Executor Registry Interface
 * (Minimal interface to break circular dependency)
 */
export interface ExecutorRegistry {
  /** Get count of registered executors */
  getExecutorCount(): number;

  /** Check if executor exists */
  hasExecutor(name: string): boolean;

  /** Get all executor names */
  getExecutorNames(): string[];

  /** Get executor instance by name (for configuration wiring) */
  getExecutor(name: string): unknown;

  /** Execute a tool */
  execute(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<any>;

  /** Update executor config (e.g., add sessionId after session creation) */
  updateConfig(updates: Partial<ExecutorConfig>): void;

  /** Get current config */
  getConfig(): ExecutorConfig;
}