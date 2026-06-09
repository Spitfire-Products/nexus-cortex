/**
 * Sub-Agent Orchestrator
 *
 * A lightweight orchestrator for sub-agent execution.
 * Creates a minimal conversation context for the sub-agent task,
 * tracks tool usage and file operations, and produces a
 * comprehensive result for the parent orchestrator.
 *
 * Design: Uses CortexOrchestrator's built-in agentic loop
 * which automatically handles tool execution. The sub-agent
 * orchestrator wraps this to add:
 * - Event emission for real-time monitoring
 * - Abort/pause signal handling
 * - Result aggregation and formatting
 *
 * @module orchestrator/SubAgentOrchestrator
 * @version 1.0.0
 */

import type { CortexOrchestrator, OrchestratorConfig } from './CortexOrchestrator.js';
import { createOrchestrator } from './OrchestratorFactory.js';
import type {
  SubAgentConfig,
  SubAgentContext,
  SubAgentResult,
  ToolUsageSummary,
  SubAgentCostMetrics,
  ISubAgentEventEmitter,
  IPauseController,
} from './SubAgentTypes.js';
import { SubAgentPermissionChecker } from './SubAgentPermissionChecker.js';
import type { PermissionPolicy } from '../middleware/contracts/MiddlewareContracts.js';

/**
 * Options for sub-agent orchestrator creation
 */
export interface SubAgentOrchestratorOptions {
  /** Sub-agent configuration */
  config: SubAgentConfig;

  /** Context from parent orchestrator */
  context: SubAgentContext;

  /** Parent's permission policies */
  parentPolicies?: PermissionPolicy[];

  /** Base orchestrator configuration */
  baseConfig: Partial<OrchestratorConfig>;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Sub-Agent Orchestrator
 *
 * Manages the lifecycle of a sub-agent execution:
 * 1. Creates isolated orchestrator with agent's system prompt
 * 2. Runs the task through orchestrator's agentic loop
 * 3. Tracks tool usage and file operations from responses
 * 4. Handles abort/pause signals via polling
 * 5. Produces comprehensive result for parent
 */
export class SubAgentOrchestrator {
  private options: SubAgentOrchestratorOptions;
  private orchestrator?: CortexOrchestrator;
  private permissionChecker: SubAgentPermissionChecker;
  private eventEmitter: ISubAgentEventEmitter;
  private pauseController: IPauseController;
  private abortController: AbortController;

  // Execution tracking
  private startTime?: Date;
  private endTime?: Date;
  private turnCount: number = 0;
  private toolUsage: Map<string, ToolUsageSummary> = new Map();
  private filesRead: Set<string> = new Set();
  private filesModified: Set<string> = new Set();
  private inputTokens: number = 0;
  private outputTokens: number = 0;
  private cacheHits: number = 0;
  private fullResponseParts: string[] = [];
  private isRunning: boolean = false;
  private status: SubAgentResult['status'] = 'completed';
  private error?: Error;

  constructor(options: SubAgentOrchestratorOptions) {
    this.options = options;
    this.eventEmitter = options.context.eventEmitter;
    this.pauseController = options.context.pauseController;
    this.abortController = options.context.abortController;

    // Create permission checker
    this.permissionChecker = new SubAgentPermissionChecker({
      agentDefinition: options.config.agentDefinition,
      agentId: options.config.agentId,
      parentSessionId: options.context.parentSessionId,
      debug: options.debug,
    });

    if (options.parentPolicies) {
      this.permissionChecker.setParentPolicies(options.parentPolicies);
    }
  }

  /**
   * Execute the sub-agent task
   *
   * @returns SubAgentResult with execution details
   */
  async execute(): Promise<SubAgentResult> {
    this.startTime = new Date();
    this.isRunning = true;

    const { config, context, baseConfig } = this.options;
    const { agentDefinition, taskPrompt, modelId, agentId } = config;

    try {
      // Emit started event
      this.eventEmitter.emit('agent:started', {
        agentId,
        agentName: agentDefinition.name,
        model: modelId,
        task: this.truncateForDisplay(taskPrompt, 200),
        parentSessionId: context.parentSessionId,
      });

      // Create orchestrator for sub-agent using factory
      const projectPath = baseConfig.projectPath ?? process.cwd();
      const orchestratorConfig: OrchestratorConfig = {
        ...baseConfig,
        defaultModelId: modelId,
        projectPath,
        debug: this.options.debug,
        // Sub-agents use minimal middleware
        enableMcp: false, // Sub-agents don't manage MCP
        // Include the agent's system prompt
        systemMessages: [agentDefinition.systemPrompt],
      } as OrchestratorConfig;

      this.orchestrator = await createOrchestrator(orchestratorConfig, {
        enablePermissions: true,
        permissionMode: 'auto', // Sub-agents auto-approve within their tool restrictions
      });

      // Create session for the sub-agent
      await this.orchestrator.createSession(projectPath, modelId);

      // Execute the task through orchestrator's agentic loop
      await this.runAgenticExecution(taskPrompt);

    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.status = 'error';

      this.eventEmitter.emit('agent:error', {
        agentId,
        agentName: agentDefinition.name,
        error: this.error,
      });
    } finally {
      this.isRunning = false;
      this.endTime = new Date();
    }

    return this.buildResult();
  }

  /**
   * Run the agentic execution with abort/pause checking
   */
  private async runAgenticExecution(taskPrompt: string): Promise<void> {
    const { config } = this.options;
    const timeoutMs = config.timeoutMs ?? 300000; // 5 minutes default
    const loopStartTime = Date.now();

    // Check abort before starting
    if (this.abortController.signal.aborted) {
      this.status = 'interrupted';
      this.eventEmitter.emit('agent:interrupted', {
        agentId: config.agentId,
        reason: 'Aborted before execution',
      });
      return;
    }

    // Wait if paused before starting
    await this.pauseController.waitIfPaused();

    // Create timeout wrapper
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeoutMs);
    });

    // Create abort wrapper
    const abortPromise = new Promise<'abort'>((resolve) => {
      this.abortController.signal.addEventListener('abort', () => resolve('abort'));
    });

    // Execute the orchestrator's sendMessage which runs the full agentic loop
    const executionPromise = this.executeWithOrchestrator(taskPrompt);

    // Race between execution, timeout, and abort
    const result = await Promise.race([
      executionPromise.then(() => 'completed' as const),
      timeoutPromise,
      abortPromise,
    ]);

    if (result === 'timeout') {
      const elapsed = Date.now() - loopStartTime;
      this.status = 'timeout';
      this.eventEmitter.emit('agent:timeout', {
        agentId: config.agentId,
        timeoutMs,
        elapsedMs: elapsed,
      });
    } else if (result === 'abort') {
      this.status = 'interrupted';
      this.eventEmitter.emit('agent:interrupted', {
        agentId: config.agentId,
        reason: 'User interrupted',
      });
    } else {
      this.status = 'completed';
    }
  }

  /**
   * Execute the task using orchestrator's built-in agentic loop
   */
  private async executeWithOrchestrator(taskPrompt: string): Promise<void> {
    const { config } = this.options;

    // The orchestrator's sendMessage handles the full agentic loop
    // including tool execution, multi-turn conversations, etc.
    const response = await this.orchestrator!.sendMessage(taskPrompt);

    this.turnCount = 1; // The orchestrator handles multiple internal turns

    // Track tokens
    if (response.usage) {
      this.inputTokens = response.usage.inputTokens ?? 0;
      this.outputTokens = response.usage.outputTokens ?? 0;
      // Check for cache stats
      if (response.usage.cache) {
        // Use cacheReadTokens as a proxy for cache hits
        this.cacheHits = response.usage.cache.cacheReadTokens ?? 0;
      }
    }

    // Extract text content from response
    const textContent = this.extractTextContent(response.content);
    if (textContent) {
      this.fullResponseParts.push(textContent);
      this.eventEmitter.emit('agent:text', {
        agentId: config.agentId,
        text: textContent,
        isFinal: true,
      });
    }

    // Track tool usage from response
    if (response.toolUses && Array.isArray(response.toolUses)) {
      for (const toolUse of response.toolUses) {
        this.trackToolFromResponse(toolUse);
      }
    }

    // Emit progress
    this.eventEmitter.emit('agent:progress', {
      agentId: config.agentId,
      turnNumber: this.turnCount,
      totalTokens: this.inputTokens + this.outputTokens,
      elapsedMs: Date.now() - (this.startTime?.getTime() ?? Date.now()),
    });
  }

  /**
   * Extract text content from response content
   */
  private extractTextContent(content: string | unknown[]): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      const textBlocks = content
        .filter((block): block is { type: 'text'; text: string } =>
          typeof block === 'object' && block !== null && 'type' in block && block.type === 'text'
        )
        .map((block) => block.text);

      return textBlocks.join('\n\n');
    }

    return '';
  }

  /**
   * Track tool usage from response tool use blocks
   */
  private trackToolFromResponse(toolUse: unknown): void {
    if (typeof toolUse !== 'object' || toolUse === null) return;

    const tu = toolUse as { name?: string; input?: Record<string, unknown>; id?: string };
    const toolName = tu.name ?? 'unknown';

    // Update usage stats
    const existing = this.toolUsage.get(toolName) ?? {
      name: toolName,
      callCount: 0,
      totalDuration: 0,
      errors: 0,
    };

    existing.callCount++;
    this.toolUsage.set(toolName, existing);

    // Track file operations
    if (tu.input) {
      this.trackFileOperation(toolName, tu.input);
    }

    // Emit tool call event
    this.eventEmitter.emit('agent:tool_call', {
      agentId: this.options.config.agentId,
      toolName,
      toolInput: tu.input ?? {},
      toolId: tu.id ?? 'unknown',
    });
  }

  /**
   * Track file operations from tool inputs
   */
  private trackFileOperation(toolName: string, input: Record<string, unknown>): void {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return;

    const lowerName = toolName.toLowerCase();

    if (lowerName === 'read' || lowerName === 'glob' || lowerName === 'grep') {
      this.filesRead.add(filePath);
    } else if (lowerName === 'write' || lowerName === 'edit') {
      this.filesModified.add(filePath);
    }
  }

  /**
   * Build the final result
   */
  private buildResult(): SubAgentResult {
    const { config } = this.options;
    const durationMs = this.endTime && this.startTime
      ? this.endTime.getTime() - this.startTime.getTime()
      : 0;

    // Build tool usage summary
    const toolsUsed: ToolUsageSummary[] = Array.from(this.toolUsage.values());

    // Build cost metrics (rough estimate)
    const cost: SubAgentCostMetrics = {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCost: this.estimateCost(this.inputTokens, this.outputTokens),
      cacheHits: this.cacheHits,
    };

    // Build summary
    const summary = this.buildSummary();

    const result: SubAgentResult = {
      agentId: config.agentId,
      agentName: config.agentDefinition.name,
      model: config.modelId,
      startTime: this.startTime ?? new Date(),
      endTime: this.endTime ?? new Date(),
      durationMs,
      turnCount: this.turnCount,
      status: this.status,
      summary,
      fullResponse: this.fullResponseParts.join('\n\n'),
      toolsUsed,
      filesRead: Array.from(this.filesRead),
      filesModified: Array.from(this.filesModified),
      cost,
    };

    // Add error if present
    if (this.error) {
      result.error = {
        message: this.error.message,
        type: this.error.name,
        stack: this.error.stack,
      };
    }

    // Emit completed event
    this.eventEmitter.emit('agent:completed', {
      agentId: config.agentId,
      result,
    });

    return result;
  }

  /**
   * Build a summary for the parent LLM
   */
  private buildSummary(): string {
    const { config } = this.options;
    const parts: string[] = [];

    parts.push(`Agent "${config.agentDefinition.name}" ${this.status}`);

    if (this.turnCount > 0) {
      parts.push(`Completed ${this.turnCount} turn(s)`);
    }

    if (this.toolUsage.size > 0) {
      const tools = Array.from(this.toolUsage.keys()).join(', ');
      parts.push(`Used tools: ${tools}`);
    }

    if (this.filesModified.size > 0) {
      parts.push(`Modified ${this.filesModified.size} file(s)`);
    }

    if (this.error) {
      parts.push(`Error: ${this.error.message}`);
    }

    // Add last response snippet
    if (this.fullResponseParts.length > 0) {
      const lastResponse = this.fullResponseParts[this.fullResponseParts.length - 1] ?? '';
      const snippet = this.truncateForDisplay(lastResponse, 500);
      parts.push(`\nFinal response:\n${snippet}`);
    }

    return parts.join('. ');
  }

  /**
   * Estimate cost based on model pricing
   */
  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Default pricing (Claude Sonnet 4.5 rates)
    const inputRate = 3.0 / 1_000_000; // $3 per 1M tokens
    const outputRate = 15.0 / 1_000_000; // $15 per 1M tokens

    return inputTokens * inputRate + outputTokens * outputRate;
  }

  /**
   * Truncate text for display
   */
  private truncateForDisplay(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 3) + '...';
  }

  /**
   * Get current execution status
   */
  getStatus(): {
    isRunning: boolean;
    turnCount: number;
    status: SubAgentResult['status'];
    elapsedMs: number;
  } {
    const elapsedMs = this.startTime
      ? Date.now() - this.startTime.getTime()
      : 0;

    return {
      isRunning: this.isRunning,
      turnCount: this.turnCount,
      status: this.status,
      elapsedMs,
    };
  }

  /**
   * Get permission summary
   */
  getPermissionSummary(): ReturnType<SubAgentPermissionChecker['getSummary']> {
    return this.permissionChecker.getSummary();
  }
}
