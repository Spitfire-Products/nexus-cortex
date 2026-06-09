/**
 * Node.js ToolExecutorRegistry Adapter
 *
 * Wraps ExecutorRegistry behind the ToolExecutorRegistry interface.
 * Bridges method names (execute → executeToolCall) and adds getAllTools().
 *
 * @module adapters/node/NodeToolExecutorAdapter
 */

import type {
  ToolExecutorRegistry,
  ToolExecutor,
  ToolResult,
  ToolDefinition
} from '../../interfaces/ToolExecutorRegistry.js';
import { toolFactory } from '../../tools/index.js';

// Use the concrete type from executors — this adapter wraps it
type ExecutorRegistryLike = {
  getExecutor(toolName: string): any;
  execute(toolName: string, params: Record<string, any>, signal: AbortSignal, updateOutput?: (output: string) => void): Promise<ToolResult>;
};

export class NodeToolExecutorAdapter implements ToolExecutorRegistry {
  constructor(private registry: ExecutorRegistryLike) {}

  getExecutor(toolName: string): ToolExecutor | undefined {
    const executor = this.registry.getExecutor(toolName);
    if (!executor) return undefined;
    // BaseTool has compatible execute(params, signal, updateOutput?) signature
    return executor as unknown as ToolExecutor;
  }

  getAllTools(): ToolDefinition[] {
    return toolFactory.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.schema as ToolDefinition['inputSchema'],
    }));
  }

  async executeToolCall(
    toolName: string,
    params: Record<string, any>,
    signal: AbortSignal
  ): Promise<ToolResult> {
    return this.registry.execute(toolName, params, signal);
  }
}
