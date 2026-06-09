/**
 * ToolExecutorRegistry Interface
 *
 * Abstracts tool definition and execution.
 * The orchestrator uses this to resolve tool definitions, validate parameters,
 * check permissions, and execute tool calls.
 *
 * Node.js impl: wraps ExecutorRegistry + BaseTool subclasses (child_process, fs, shell)
 * Browser impl: host-provided tools (fetch, DOM APIs)
 *
 * @module interfaces/ToolExecutorRegistry
 */

import type { CanonicalContentBlock } from '@nexus-cortex/types';

/**
 * Tool execution result.
 *
 * Mirrors the existing ToolResult from executors/base/ToolResult.ts
 * but defined here as an interface for the abstraction boundary.
 */
export interface ToolResult {
  /** Content to send back to LLM (string or structured content blocks) */
  llmContent: string | CanonicalContentBlock[];
  /** Content to display to user (optional — falls back to llmContent) */
  returnDisplay?: string;
  /** Whether execution was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Execution metadata */
  metadata?: {
    executionTime?: number;
    resourcesUsed?: {
      files?: string[];
      network?: string[];
      commands?: string[];
    };
    [key: string]: any;
  };
}

/**
 * Tool call confirmation details — returned by tools that need user approval.
 */
export interface ToolCallConfirmationDetails {
  /** Human-readable description of what the tool will do */
  description: string;
  /** Whether confirmation is required */
  requiresConfirmation: boolean;
  /** Severity level for UI display */
  severity?: 'info' | 'warning' | 'danger';
  /** Additional context for confirmation prompt */
  context?: string;
}

/**
 * Tool definition — schema describing a single tool's interface.
 */
export interface ToolDefinition {
  /** Tool name (PascalCase canonical form) */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Single tool executor — validates, confirms, and executes a tool.
 */
export interface ToolExecutor {
  /** Tool name */
  readonly name: string;

  /**
   * Validate tool parameters before execution.
   *
   * @param params - Tool input parameters
   * @returns null if valid, error message string if invalid
   */
  validateParams(params: Record<string, any>): string | null;

  /**
   * Check if this tool call needs user confirmation.
   *
   * @param params - Tool input parameters
   * @param signal - Abort signal for timeout enforcement
   * @returns Confirmation details, or false if no confirmation needed
   */
  shouldConfirmExecute(
    params: Record<string, any>,
    signal: AbortSignal
  ): Promise<ToolCallConfirmationDetails | false>;

  /**
   * Execute the tool.
   *
   * @param params - Tool input parameters
   * @param signal - Abort signal for TOOL_TIMEOUT_MS enforcement
   * @param updateOutput - Optional callback for streaming output updates
   * @returns Execution result
   */
  execute(
    params: Record<string, any>,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult>;
}

/**
 * Tool Executor Registry — resolves and executes tools.
 */
export interface ToolExecutorRegistry {
  /**
   * Get an executor for a specific tool.
   *
   * @param toolName - Tool name (PascalCase)
   * @returns Tool executor or undefined if not registered
   */
  getExecutor(toolName: string): ToolExecutor | undefined;

  /**
   * Get all available tool definitions (for sending to AI providers).
   *
   * @returns Array of tool definitions with schemas
   */
  getAllTools(): ToolDefinition[];

  /**
   * Execute a tool call (convenience method that resolves executor + calls execute).
   *
   * @param toolName - Tool name
   * @param params - Tool input parameters
   * @param signal - Abort signal for timeout enforcement
   * @returns Execution result
   */
  executeToolCall(
    toolName: string,
    params: Record<string, any>,
    signal: AbortSignal
  ): Promise<ToolResult>;
}
