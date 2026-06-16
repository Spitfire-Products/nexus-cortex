/**
 * Sub-Agent Manager
 *
 * Central manager for spawning, tracking, and controlling sub-agents.
 * Implements the ISubAgentManager interface and provides:
 * - Agent spawning with model resolution
 * - Concurrent agent tracking
 * - Pause/resume/interrupt controls
 * - Guidance message injection
 * - Event streaming coordination
 *
 * @module orchestrator/SubAgentManager
 * @version 1.0.0
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AgentDefinition,
  SubAgentResult,
  ISubAgentManager,
  ISubAgentEventEmitter,
  SpawnAgentOptions,
  SubAgentConfig,
  SubAgentContext,
} from './SubAgentTypes.js';
import { SubAgentEventEmitter, getGlobalSubAgentEmitter } from './SubAgentEventEmitter.js';
import { SubAgentOrchestrator } from './SubAgentOrchestrator.js';
import { PauseController, createPauseControllerWithAbort } from './PauseController.js';
import { ModelAliasResolver, getDefaultResolver } from '../models/registry/ModelAliasResolver.js';
import { modelWithKeyFallback } from '../models/registry/modelKeyAvailability.js';
import { ModelRouterMatrix } from '../training/ModelRouterMatrix.js';
import { classifyTask } from '../training/TaskClassifier.js';
import type { OrchestratorConfig } from './CortexOrchestrator.js';
import type { PermissionPolicy } from '../middleware/contracts/MiddlewareContracts.js';

/**
 * Last-resort sub-agent model when an agent is `inherit`/unset AND no driver
 * default is configured. DeepSeek is the standing default: most capable per
 * dollar, and it honors the no-xAI cost constraint (a grok/sonnet fallback here
 * would silently bill expensive providers for routine sub-agent work).
 */
const DEFAULT_SUBAGENT_MODEL = 'deepseek-v4-flash';

/**
 * Configuration for the sub-agent manager
 */
export interface SubAgentManagerConfig {
  /** Base orchestrator configuration for child agents */
  baseOrchestratorConfig: Partial<OrchestratorConfig>;

  /** Parent session ID for correlation */
  parentSessionId: string;

  /** Parent turn number when manager was created */
  parentTurnNumber: number;

  /** Parent's permission policies */
  parentPolicies?: PermissionPolicy[];

  /** Default model ID if not specified */
  defaultModelId?: string;

  /** Custom model alias resolver */
  modelResolver?: ModelAliasResolver;

  /** Custom event emitter (default: global emitter) */
  eventEmitter?: SubAgentEventEmitter;

  /** Maximum concurrent agents */
  maxConcurrentAgents?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * State of an active agent
 */
interface ActiveAgentState {
  agentId: string;
  agentName: string;
  orchestrator: SubAgentOrchestrator;
  pauseController: PauseController;
  abortController: AbortController;
  startTime: Date;
  promise: Promise<SubAgentResult>;
}

/**
 * Sub-Agent Manager
 *
 * Main entry point for spawning and managing sub-agents.
 *
 * @example
 * ```typescript
 * const manager = new SubAgentManager({
 *   baseOrchestratorConfig: { projectPath: '/workspace' },
 *   parentSessionId: 'session-123',
 *   parentTurnNumber: 5,
 * });
 *
 * const result = await manager.spawnAgent(agentDef, 'Review the auth module');
 * console.log(result.summary);
 * ```
 */
export class SubAgentManager implements ISubAgentManager {
  private config: SubAgentManagerConfig;
  private eventEmitter: SubAgentEventEmitter;
  private modelResolver: ModelAliasResolver;
  private activeAgents: Map<string, ActiveAgentState> = new Map();
  private completedAgents: Map<string, SubAgentResult> = new Map();
  private guidanceMessages: Map<string, string[]> = new Map();

  constructor(config: SubAgentManagerConfig) {
    this.config = {
      maxConcurrentAgents: 5,
      debug: false,
      ...config,
    };

    this.eventEmitter = config.eventEmitter ?? getGlobalSubAgentEmitter();
    this.modelResolver = config.modelResolver ?? getDefaultResolver();
  }

  /**
   * Spawn a new sub-agent to execute a task
   *
   * @param agentDefinition Agent definition from TaskToolExecutor
   * @param taskPrompt The task for the agent to perform
   * @param options Optional spawn options
   * @returns Promise resolving to the agent's result
   */
  async spawnAgent(
    agentDefinition: AgentDefinition,
    taskPrompt: string,
    options: SpawnAgentOptions = {}
  ): Promise<SubAgentResult> {
    // Check concurrent limit
    if (this.activeAgents.size >= (this.config.maxConcurrentAgents ?? 5)) {
      throw new Error(
        `Maximum concurrent agents (${this.config.maxConcurrentAgents}) reached. ` +
        'Wait for an agent to complete or interrupt one.'
      );
    }

    // Generate unique agent ID
    const agentId = this.generateAgentId(agentDefinition.name);

    // Resolve model. An explicit 'auto' delegates to the trust-gated router
    // (overrides the global MODEL_ROUTER_ENABLED flag); resolveAutoModel always
    // returns a concrete model (routed when trustworthy, else parent's model).
    let modelId = this.resolveModel(agentDefinition, options.modelOverride);
    if (modelId === 'auto') {
      // The router can pick a model whose provider key isn't configured — key-check it too.
      modelId = modelWithKeyFallback(
        this.resolveAutoModel(taskPrompt),
        this.config.defaultModelId ?? DEFAULT_SUBAGENT_MODEL,
      );
    }

    // Create controllers
    const abortController = new AbortController();
    const pauseController = createPauseControllerWithAbort(abortController.signal);

    // Build context
    const context: SubAgentContext = {
      parentSessionId: this.config.parentSessionId,
      parentTurnNumber: this.config.parentTurnNumber,
      eventEmitter: this.eventEmitter,
      abortController,
      pauseController,
      approvalMode: 'inherit', // Inherit from parent
    };

    // Build sub-agent config
    const subAgentConfig: SubAgentConfig = {
      agentId,
      agentDefinition,
      taskPrompt: this.buildEnhancedPrompt(taskPrompt, options.additionalContext),
      modelId,
      timeoutMs: options.timeoutMs ?? 300000,
      maxTurns: options.maxTurns ?? 50,
    };

    // Create orchestrator
    const orchestrator = new SubAgentOrchestrator({
      config: subAgentConfig,
      context,
      parentPolicies: this.config.parentPolicies,
      baseConfig: this.config.baseOrchestratorConfig,
      debug: this.config.debug,
    });

    // Start execution
    const promise = this.executeAgent(orchestrator, agentId);

    // Track active agent
    const state: ActiveAgentState = {
      agentId,
      agentName: agentDefinition.name,
      orchestrator,
      pauseController,
      abortController,
      startTime: new Date(),
      promise,
    };

    this.activeAgents.set(agentId, state);
    this.guidanceMessages.set(agentId, []);

    if (this.config.debug) {
      console.log(
        `[SubAgentManager] Spawned agent "${agentDefinition.name}" (${agentId}) with model ${modelId}`
      );
    }

    // Wait for completion
    const result = await promise;

    // Move to completed
    this.activeAgents.delete(agentId);
    this.completedAgents.set(agentId, result);
    this.guidanceMessages.delete(agentId);

    return result;
  }

  /**
   * Execute an agent and handle cleanup
   */
  private async executeAgent(
    orchestrator: SubAgentOrchestrator,
    agentId: string
  ): Promise<SubAgentResult> {
    try {
      return await orchestrator.execute();
    } catch (error) {
      // Ensure agent is cleaned up on error
      this.activeAgents.delete(agentId);

      throw error;
    }
  }

  /**
   * Resolve model ID from agent definition or override
   */
  private resolveModel(agentDefinition: AgentDefinition, override?: string): string {
    const fallback = this.config.defaultModelId ?? DEFAULT_SUBAGENT_MODEL;

    // Use override if provided
    if (override) {
      // 'auto' is handled by the caller (resolveAutoModel) — pass it through untouched.
      if (override === 'auto') return 'auto';
      const resolved = this.modelResolver.resolveToId(override) ?? override;
      // Key-aware fallback: if the chosen model's provider key isn't configured on this
      // install, run on the orchestrator's model instead of failing with "API key not found".
      return modelWithKeyFallback(resolved, fallback);
    }

    // Use agent's model preference
    const agentModel = agentDefinition.model;

    // Handle 'inherit'
    if (agentModel === 'inherit' || !agentModel) {
      return fallback;
    }

    // Resolve alias, then apply the key-aware fallback (e.g. a profile pinned to `sonnet`
    // on a DeepSeek-only install falls back to the orchestrator model).
    const resolved = this.modelResolver.resolveToId(agentModel) ?? agentModel;
    return modelWithKeyFallback(resolved, fallback);
  }

  private routerMatrix?: ModelRouterMatrix;
  private getRouterMatrix(): ModelRouterMatrix {
    if (!this.routerMatrix) {
      const root =
        (this.config.baseOrchestratorConfig as { projectPath?: string } | undefined)?.projectPath ||
        process.env.PROJECT_ROOT ||
        process.cwd();
      this.routerMatrix = new ModelRouterMatrix(root);
    }
    return this.routerMatrix;
  }

  /**
   * Resolve an explicit `model: 'auto'` sub-agent dispatch via the model router.
   *
   * This is the per-dispatch OPT-IN: passing 'auto' lets the orchestrator
   * delegate model choice to the router, and it overrides the global
   * MODEL_ROUTER_ENABLED flag (the orchestrator chose to route by passing
   * 'auto'). But it only ACTUALLY routes when the decision is trustworthy —
   * the task classifies with enough confidence AND the matrix has >= minSamples
   * real benchmark observations for that task type. Otherwise it inherits the
   * parent's model. The whole point of the router is to raise routing-decision
   * quality over time; until a task type has earned trust, 'auto' is a safe
   * no-op (parent model), and the recorded outcomes push it toward trust.
   *
   * Never returns 'auto', so the sub-agent always gets a concrete, resolvable
   * model — the auto path can never crash on getModel('auto').
   */
  private resolveAutoModel(taskPrompt: string): string {
    const parentModel = this.config.defaultModelId ?? DEFAULT_SUBAGENT_MODEL;
    const minConfidence = Number(process.env.ROUTER_MIN_CONFIDENCE ?? '0.3');
    const minSamples = Number(process.env.ROUTER_MIN_SAMPLES ?? '3');
    try {
      const { taskType, confidence } = classifyTask(taskPrompt);
      if (confidence < minConfidence) return parentModel;
      // OPT-IN explore/exploit: when MODEL_ROUTER_EXPLORATION is on, Thompson
      // sampling deliberately gives thinly-sampled models a chance (the trust
      // gate's opposite philosophy — it explores to gather data). Default off →
      // the conservative trust-gated greedy pick. Either path falls back to the
      // parent model when there's no eligible recommendation, so 'auto' never
      // routes to a banned (MODEL_ROUTER_EXCLUDE) or unresolvable model.
      // MODEL_ROUTER_EXCLUDE is a comma-separated ban list — each entry is an exact
      // model ID or a 'prefix*' wildcard, so multiple models/providers can be excluded
      // at once (e.g. "grok*,gpt-4o"). Applied to BOTH routing paths.
      const exclude = (process.env.MODEL_ROUTER_EXCLUDE ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const explore = process.env.MODEL_ROUTER_EXPLORATION === 'true';
      const recommended = explore
        ? this.getRouterMatrix().recommendThompson(taskType, { exclude })
        : this.getRouterMatrix().recommendTrusted(taskType, minSamples, exclude);
      if (!recommended) return parentModel;
      return this.modelResolver.resolveToId(recommended) ?? recommended;
    } catch {
      return parentModel; // classifier/matrix error → safe inherit, never crash
    }
  }

  /**
   * Build enhanced prompt with additional context
   */
  private buildEnhancedPrompt(taskPrompt: string, additionalContext?: string): string {
    if (!additionalContext) {
      return taskPrompt;
    }

    return `${taskPrompt}\n\n## Additional Context\n\n${additionalContext}`;
  }

  /**
   * Generate a unique agent ID
   */
  private generateAgentId(agentName: string): string {
    const shortId = uuidv4().split('-')[0];
    return `${agentName}-${shortId}`;
  }

  /**
   * Pause a running agent
   *
   * @param agentId Agent ID to pause
   * @returns true if agent was found and paused
   */
  pauseAgent(agentId: string): boolean {
    const state = this.activeAgents.get(agentId);
    if (!state) {
      return false;
    }

    if (state.pauseController.isPaused()) {
      return true; // Already paused
    }

    state.pauseController.pause();

    this.eventEmitter.emit('agent:paused', { agentId });

    if (this.config.debug) {
      console.log(`[SubAgentManager] Paused agent ${agentId}`);
    }

    return true;
  }

  /**
   * Resume a paused agent
   *
   * @param agentId Agent ID to resume
   * @returns true if agent was found and resumed
   */
  resumeAgent(agentId: string): boolean {
    const state = this.activeAgents.get(agentId);
    if (!state) {
      return false;
    }

    if (!state.pauseController.isPaused()) {
      return true; // Already running
    }

    state.pauseController.resume();

    this.eventEmitter.emit('agent:resumed', { agentId });

    if (this.config.debug) {
      console.log(`[SubAgentManager] Resumed agent ${agentId}`);
    }

    return true;
  }

  /**
   * Interrupt (abort) a running agent
   *
   * @param agentId Agent ID to interrupt
   * @param reason Reason for interruption
   * @returns true if agent was found and interrupted
   */
  interruptAgent(agentId: string, reason: string): boolean {
    const state = this.activeAgents.get(agentId);
    if (!state) {
      return false;
    }

    state.abortController.abort();

    this.eventEmitter.emit('agent:interrupted', {
      agentId,
      reason,
    });

    if (this.config.debug) {
      console.log(`[SubAgentManager] Interrupted agent ${agentId}: ${reason}`);
    }

    return true;
  }

  /**
   * Send guidance message to a running agent
   *
   * The guidance will be injected into the agent's next turn.
   *
   * @param agentId Agent ID to guide
   * @param message Guidance message
   * @returns true if agent was found
   */
  async guideAgent(agentId: string, message: string): Promise<boolean> {
    const state = this.activeAgents.get(agentId);
    if (!state) {
      return false;
    }

    // Store guidance for injection
    const messages = this.guidanceMessages.get(agentId) ?? [];
    messages.push(message);
    this.guidanceMessages.set(agentId, messages);

    if (this.config.debug) {
      console.log(`[SubAgentManager] Added guidance for agent ${agentId}: ${message}`);
    }

    return true;
  }

  /**
   * Get pending guidance messages for an agent
   */
  getGuidanceMessages(agentId: string): string[] {
    return this.guidanceMessages.get(agentId) ?? [];
  }

  /**
   * Clear guidance messages after they've been processed
   */
  clearGuidanceMessages(agentId: string): void {
    this.guidanceMessages.set(agentId, []);
  }

  /**
   * Get the event emitter for subscribing to agent events
   */
  getEventEmitter(): ISubAgentEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Get list of active agent IDs
   */
  getActiveAgentIds(): string[] {
    return Array.from(this.activeAgents.keys());
  }

  /**
   * Check if an agent is currently active
   */
  isAgentActive(agentId: string): boolean {
    return this.activeAgents.has(agentId);
  }

  /**
   * Get status of an active agent
   */
  getAgentStatus(agentId: string): {
    isActive: boolean;
    isPaused: boolean;
    elapsedMs: number;
    agentName?: string;
  } | null {
    const state = this.activeAgents.get(agentId);
    if (!state) {
      return null;
    }

    return {
      isActive: true,
      isPaused: state.pauseController.isPaused(),
      elapsedMs: Date.now() - state.startTime.getTime(),
      agentName: state.agentName,
    };
  }

  /**
   * Get result of a completed agent
   */
  getCompletedResult(agentId: string): SubAgentResult | null {
    return this.completedAgents.get(agentId) ?? null;
  }

  /**
   * Wait for all active agents to complete
   */
  async waitForAll(): Promise<SubAgentResult[]> {
    const promises = Array.from(this.activeAgents.values()).map((s) => s.promise);
    return Promise.all(promises);
  }

  /**
   * Interrupt all active agents
   */
  interruptAll(reason: string): number {
    let count = 0;
    for (const agentId of this.activeAgents.keys()) {
      if (this.interruptAgent(agentId, reason)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Pause all active agents
   */
  pauseAll(): number {
    let count = 0;
    for (const agentId of this.activeAgents.keys()) {
      if (this.pauseAgent(agentId)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Resume all paused agents
   */
  resumeAll(): number {
    let count = 0;
    for (const agentId of this.activeAgents.keys()) {
      if (this.resumeAgent(agentId)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get summary of all agents
   */
  getSummary(): {
    active: number;
    completed: number;
    agents: Array<{
      id: string;
      name: string;
      status: 'active' | 'paused' | 'completed';
      elapsedMs: number;
    }>;
  } {
    const agents: Array<{
      id: string;
      name: string;
      status: 'active' | 'paused' | 'completed';
      elapsedMs: number;
    }> = [];

    // Add active agents
    for (const [id, state] of this.activeAgents) {
      agents.push({
        id,
        name: state.agentName,
        status: state.pauseController.isPaused() ? 'paused' : 'active',
        elapsedMs: Date.now() - state.startTime.getTime(),
      });
    }

    // Add completed agents
    for (const [id, result] of this.completedAgents) {
      agents.push({
        id,
        name: result.agentName,
        status: 'completed',
        elapsedMs: result.durationMs,
      });
    }

    return {
      active: this.activeAgents.size,
      completed: this.completedAgents.size,
      agents,
    };
  }

  /**
   * Clear completed agents from memory
   */
  clearCompleted(): number {
    const count = this.completedAgents.size;
    this.completedAgents.clear();
    return count;
  }
}

/**
 * Create a sub-agent manager with sensible defaults
 */
export function createSubAgentManager(
  parentSessionId: string,
  parentTurnNumber: number,
  projectPath: string,
  options?: Partial<SubAgentManagerConfig>
): SubAgentManager {
  return new SubAgentManager({
    parentSessionId,
    parentTurnNumber,
    baseOrchestratorConfig: {
      projectPath,
      ...options?.baseOrchestratorConfig,
    },
    ...options,
  });
}
