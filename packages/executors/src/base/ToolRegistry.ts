/**
 * Tool Registry
 *
 * Manages registration and execution of tool executors
 * Central coordination point for all tool execution in Nexus Cortex
 */

import type { BaseTool } from './BaseTool.js';
import type { ToolResult } from './ToolResult.js';
import type { ExecutorConfig } from '@nexus-cortex/types';

// Re-export for backwards compatibility
export type { ExecutorConfig };

/**
 * Tool execution statistics
 */
export interface ToolExecutionStats {
  /** Tool name */
  toolName: string;

  /** Number of times executed */
  executionCount: number;

  /** Total execution time (milliseconds) */
  totalExecutionTime: number;

  /** Average execution time (milliseconds) */
  averageExecutionTime: number;

  /** Number of successful executions */
  successCount: number;

  /** Number of failed executions */
  failureCount: number;

  /** Last execution timestamp */
  lastExecuted?: Date;
}

/**
 * Tool Registry
 *
 * Manages tool executor instances and provides execution interface
 */
export class ToolRegistry {
  /** Registered tool executors */
  private tools: Map<string, BaseTool<any, any>> = new Map();

  /** Execution statistics */
  private stats: Map<string, ToolExecutionStats> = new Map();

  constructor(private config: ExecutorConfig) {}

  /**
   * Register a tool executor
   *
   * @param tool Tool executor instance
   * @throws Error if tool with same name already registered
   */
  registerTool(tool: BaseTool<any, any>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }

    this.tools.set(tool.name, tool);

    // Initialize stats
    this.stats.set(tool.name, {
      toolName: tool.name,
      executionCount: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      successCount: 0,
      failureCount: 0,
    });
  }

  /**
   * Update executor config (e.g., add sessionId after session creation)
   *
   * @param updates Partial config updates
   */
  updateConfig(updates: Partial<ExecutorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current config
   *
   * @returns Current executor config
   */
  getConfig(): ExecutorConfig {
    return { ...this.config };
  }

  /**
   * Unregister a tool executor
   *
   * @param name Tool name
   * @returns true if tool was removed, false if not found
   */
  unregisterTool(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      this.stats.delete(name);
    }
    return removed;
  }

  /**
   * Get a tool executor by name
   *
   * @param name Tool name
   * @returns Tool executor or undefined if not found
   */
  getTool(name: string): BaseTool<any, any> | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered
   *
   * @param name Tool name
   * @returns true if registered, false otherwise
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names
   *
   * @returns Array of tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get count of registered tools
   *
   * @returns Number of registered tools
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Execute a tool by name
   *
   * Main execution method that:
   * 1. Validates tool exists
   * 2. Validates parameters
   * 3. Executes tool
   * 4. Handles errors
   * 5. Updates statistics
   *
   * @param name Tool name
   * @param params Tool parameters
   * @param signal AbortSignal for cancellation
   * @param updateOutput Optional callback for streaming output
   * @returns Tool execution result
   */
  async executeTool(
    name: string,
    params: any,
    signal?: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Get tool
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        llmContent: `Tool "${name}" not found`,
        returnDisplay: `Error: Tool "${name}" not found`,
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }

    // Validate parameters
    const validationError = tool.validateToolParams(params);
    if (validationError) {
      this.updateStats(name, false, Date.now() - startTime);

      return {
        llmContent: `Invalid parameters: ${validationError}`,
        returnDisplay: `Parameter validation failed: ${validationError}`,
        success: false,
        error: validationError,
      };
    }

    // Create abort signal if not provided
    const abortSignal = signal || new AbortController().signal;

    // Execute tool
    try {
      const result = await tool.execute(params, abortSignal, updateOutput);

      // Update stats
      const executionTime = Date.now() - startTime;
      this.updateStats(name, result.success, executionTime);

      // Add execution time to metadata if not already present
      if (!result.metadata?.executionTime) {
        result.metadata = {
          ...result.metadata,
          executionTime,
        };
      }

      return result;
    } catch (error: any) {
      // Handle execution error
      const executionTime = Date.now() - startTime;
      this.updateStats(name, false, executionTime);

      return {
        llmContent: `Tool execution failed: ${error.message}`,
        returnDisplay: `Execution error: ${error.message}`,
        success: false,
        error: error.message,
        metadata: {
          executionTime,
          errorStack: error.stack,
        },
      };
    }
  }

  /**
   * Get execution statistics for a tool
   *
   * @param name Tool name
   * @returns Statistics or undefined if tool not found
   */
  getToolStats(name: string): ToolExecutionStats | undefined {
    return this.stats.get(name);
  }

  /**
   * Get execution statistics for all tools
   *
   * @returns Map of tool name to statistics
   */
  getAllStats(): Map<string, ToolExecutionStats> {
    return new Map(this.stats);
  }

  /**
   * Reset statistics for a tool
   *
   * @param name Tool name
   */
  resetToolStats(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      this.stats.set(name, {
        toolName: name,
        executionCount: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
        successCount: 0,
        failureCount: 0,
      });
    }
  }

  /**
   * Reset statistics for all tools
   */
  resetAllStats(): void {
    for (const name of this.tools.keys()) {
      this.resetToolStats(name);
    }
  }

  /**
   * Update execution statistics
   *
   * @private
   */
  private updateStats(name: string, success: boolean, executionTime: number): void {
    const stats = this.stats.get(name);
    if (!stats) return;

    stats.executionCount++;
    stats.totalExecutionTime += executionTime;
    stats.averageExecutionTime = stats.totalExecutionTime / stats.executionCount;
    stats.lastExecuted = new Date();

    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }
  }
}
