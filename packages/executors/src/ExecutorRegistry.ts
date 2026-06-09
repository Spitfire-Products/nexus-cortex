/**
 * Executor Registry
 *
 * Bridges tool definitions (in core) with tool executors (in @nexus-cortex/executors).
 * This module provides runtime access to tool implementations for execution.
 *
 * Architecture:
 * - Core package: Tool definitions (schema, metadata)
 * - Executors package: Tool implementations (execute() methods)
 * - This registry: Maps tool names to their executors
 */

import type { BaseTool, ToolResult } from './base/index.js';
import type { ExecutorConfig, ExecutorRegistry as IExecutorRegistry } from '@nexus-cortex/types';
import {
  // File operations
  ReadFileTool,
  WriteFileTool,
  WriteBinaryTool,
  EditTool,
} from './implementations/file/index.js';

import {
  // Search operations
  GlobTool,
  GrepTool,
} from './implementations/search/index.js';

import {
  // Execution operations
  ShellTool,
  BashOutputTool,
  KillShellTool,
  WorkspaceManagerTool,
  CodeExecuteTool,
  SearchToolsTool,
} from './implementations/execution/index.js';

import {
  // Web operations
  WebFetchTool,
  WebSearchTool,
  BrowseTool,
  SandboxTransferTool,
} from './implementations/web/index.js';

import {
  // UI/Planning operations
  TodoCreateTool,
  TodoUpdateTool,
  TodoListTool,
  AskUserQuestionTool,
  ExitPlanModeTool,
} from './implementations/ui/index.js';

import {
  // Notebook operations
  NotebookEditTool,
} from './implementations/notebook/index.js';

import {
  // Historical operations
  RequestHistoricalContextToolExecutor,
  SearchConversationHistoryToolExecutor,
  GetConversationSegmentToolExecutor,
  ListCompactionBoundariesToolExecutor,
  ListSessionsToolExecutor,
  LoadSessionToolExecutor,
} from './implementations/historical/index.js';

import {
  // Extension operations
  SlashCommandToolExecutor,
  SkillToolExecutor,
  ResearchBacklogToolExecutor,
  EndTurnToolExecutor,
} from './implementations/extensions/index.js';

import {
  // Agent operations
  TaskToolExecutor,
  PRAgentToolExecutor,
} from './implementations/agent/index.js';

import {
  // Artifact operations (Visual Workspace)
  CreateArtifactToolExecutor,
  InteractWithSandboxExecutor,
  ModifySandboxExecutor,
  InspectSandboxExecutor,
  SandboxScanExecutor,
  SandboxGrabExecutor,
  SandboxDetectFrameworkExecutor,
  SandboxComponentTreeExecutor,
  SandboxRenderTraceExecutor,
  StopSandboxExecutor,
} from './implementations/addon/index.js';

import {
  // Tmux operations
  TmuxSessionTool,
} from './implementations/tmux/index.js';

/**
 * Executor Registry
 *
 * Central registry that maps tool names to their executor instances.
 * Provides singleton access to all tool executors.
 */
export class ExecutorRegistry implements IExecutorRegistry {
  private executors: Map<string, BaseTool<any, ToolResult>>;
  private config: ExecutorConfig;

  constructor(config: ExecutorConfig) {
    this.config = config;
    this.executors = new Map();
    this.registerAllExecutors();
  }

  /**
   * Register all tool executors
   *
   * Creates instances of each executor and registers them by name.
   * This is called automatically on construction.
   */
  private registerAllExecutors(): void {
    // File operations
    this.register(new ReadFileTool(this.config));
    this.register(new WriteFileTool(this.config));
    this.register(new WriteBinaryTool(this.config));
    this.register(new EditTool(this.config));

    // Search operations
    this.register(new GlobTool(this.config));
    this.register(new GrepTool(this.config));

    // Execution operations
    this.register(new ShellTool(this.config));
    this.register(new BashOutputTool(this.config));
    this.register(new KillShellTool(this.config));

    // Web operations
    this.register(new WebFetchTool(this.config));
    this.register(new WebSearchTool(this.config));
    this.register(new BrowseTool());
    this.register(new SandboxTransferTool(this.config));

    // UI/Planning operations (split-tool todo pattern)
    this.register(new TodoCreateTool(this.config));
    this.register(new TodoUpdateTool(this.config));
    this.register(new TodoListTool(this.config));
    this.register(new AskUserQuestionTool(this.config));
    this.register(new ExitPlanModeTool(this.config));

    // Notebook operations
    this.register(new NotebookEditTool(this.config));

    // Historical operations
    this.register(new RequestHistoricalContextToolExecutor(this.config));
    this.register(new SearchConversationHistoryToolExecutor(this.config));
    this.register(new GetConversationSegmentToolExecutor(this.config));
    this.register(new ListCompactionBoundariesToolExecutor(this.config));
    this.register(new ListSessionsToolExecutor(this.config));
    this.register(new LoadSessionToolExecutor(this.config));

    // MCP operations
    // Note: DiscoveredMcpToolExecutor is created dynamically when MCP servers are discovered
    // It's not pre-registered here

    // Extension operations
    this.register(new SlashCommandToolExecutor(this.config));
    this.register(new SkillToolExecutor(this.config));
    this.register(new ResearchBacklogToolExecutor({ workingDirectory: this.config.workingDirectory || process.cwd() }));
    this.register(new EndTurnToolExecutor());

    // Agent operations
    this.register(new TaskToolExecutor(this.config));
    this.register(new PRAgentToolExecutor(this.config));

    // Workspace operations
    this.register(new WorkspaceManagerTool(this.config));

    // Artifact operations (Visual Workspace)
    // These tools use workingDirectory from config or no args
    // Renamed from CreateAddon to CreateArtifact (clearer semantics)
    this.register(new CreateArtifactToolExecutor({ workingDirectory: this.config.workingDirectory || process.cwd() }));
    this.register(new InteractWithSandboxExecutor());
    this.register(new ModifySandboxExecutor({ workingDirectory: this.config.workingDirectory || process.cwd() }));
    this.register(new InspectSandboxExecutor());
    this.register(new SandboxScanExecutor());
    this.register(new SandboxGrabExecutor());
    this.register(new SandboxDetectFrameworkExecutor());
    this.register(new SandboxComponentTreeExecutor());
    this.register(new SandboxRenderTraceExecutor());
    this.register(new StopSandboxExecutor({ workingDirectory: this.config.workingDirectory || process.cwd() }));

    // Code execution (token-efficient tool chaining)
    this.register(new CodeExecuteTool());

    // Tool discovery (progressive loading)
    this.register(new SearchToolsTool());

    // Tmux operations
    this.register(new TmuxSessionTool(this.config));
  }

  /**
   * Register a single executor
   */
  private register(executor: BaseTool<any, ToolResult>): void {
    this.executors.set(executor.name, executor);
  }

  /**
   * Get an executor by tool name
   *
   * @param toolName Name of the tool (e.g., "Read", "Write", "Bash")
   * @returns Executor instance or undefined if not found
   */
  getExecutor(toolName: string): BaseTool<any, ToolResult> | undefined {
    return this.executors.get(toolName);
  }

  /**
   * Check if an executor exists for a tool
   */
  hasExecutor(toolName: string): boolean {
    return this.executors.has(toolName);
  }

  /**
   * Get all registered executor names
   */
  getExecutorNames(): string[] {
    return Array.from(this.executors.keys());
  }

  /**
   * Get count of registered executors
   */
  getExecutorCount(): number {
    return this.executors.size;
  }

  /**
   * Update executor config (e.g., add sessionId after session creation)
   *
   * This updates the shared config object that all executors reference.
   * Since executor tools receive the config object by reference in their constructor,
   * updating properties directly will propagate to all tools.
   *
   * @param updates Partial config updates
   */
  updateConfig(updates: Partial<ExecutorConfig>): void {
    // Mutate the existing config object instead of creating a new one
    // so that all executor tool instances (which hold a reference) get the updates
    Object.assign(this.config, updates);
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
   * Execute a tool by name
   *
   * @param toolName Name of the tool to execute
   * @param params Tool parameters
   * @param signal AbortSignal for cancellation
   * @param updateOutput Optional callback for streaming output
   * @returns Tool execution result
   * @throws Error if executor not found or validation fails
   */
  async execute(
    toolName: string,
    params: any,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const executor = this.getExecutor(toolName);
    if (!executor) {
      throw new Error(`No executor found for tool: ${toolName}`);
    }

    // Validate parameters
    const validationError = executor.validateToolParams(params);
    if (validationError) {
      throw new Error(`Parameter validation failed for ${toolName}: ${validationError}`);
    }

    // Execute the tool
    return await executor.execute(params, signal, updateOutput);
  }
}

/**
 * Create executor registry with default config
 *
 * @param config Executor configuration
 * @returns Configured executor registry instance
 */
export function createExecutorRegistry(config: ExecutorConfig): ExecutorRegistry {
  return new ExecutorRegistry(config);
}
