/**
 * Sub-Agent Process Manager
 *
 * Manages sub-agents as independent child processes. Each sub-agent runs
 * in its own Node.js process with its own context window and can execute
 * in true parallel with other sub-agents.
 *
 * Key features:
 * - True parallelism via child_process.fork()
 * - Process isolation (crash containment)
 * - Independent context windows (no parent context consumption)
 * - Real-time progress streaming via IPC
 * - Abort/pause/resume controls
 *
 * Future: Visual monitoring of each agent's console output
 *
 * @module orchestrator/SubAgentProcessManager
 * @version 1.0.0
 */

import { fork, execSync, type ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import type {
  AgentDefinition,
  SubAgentResult,
  SpawnAgentOptions,
  ISubAgentManager,
  ISubAgentEventEmitter,
} from './SubAgentTypes.js';
import {
  sendToChild,
  type ChildToParentMessage,
  type IPCStartMessage,
  type IPCPermissionRequestMessage,
} from './SubAgentIPC.js';
import type { ApprovalHandler } from '../middleware/contracts/MiddlewareContracts.js';

// ============================================
// TYPES
// ============================================

/**
 * Configuration for the process manager
 */
export interface SubAgentProcessManagerConfig {
  /** Project path for agents */
  projectPath: string;

  /** Parent session ID for correlation */
  parentSessionId: string;

  /** Default model ID */
  defaultModelId: string;

  /** Maximum concurrent agent processes */
  maxConcurrentAgents?: number;

  /** Path to agent-mode.js entry point */
  agentModulePath?: string;

  /** Enable debug logging */
  debug?: boolean;

  /**
   * Approval handler from parent orchestrator.
   * Used to forward permission requests from sub-agents to the user.
   * If not provided, all permission requests will be denied.
   */
  approvalHandler?: ApprovalHandler;
}

/**
 * State of an active agent process
 */
interface AgentProcessState {
  agentId: string;
  agentName: string;
  modelId: string;
  process: ChildProcess;
  startTime: Date;
  status: 'starting' | 'running' | 'completed' | 'error' | 'interrupted' | 'timeout';
  promise: Promise<SubAgentResult>;
  resolve: (result: SubAgentResult) => void;
  reject: (error: Error) => void;
  toolUseId?: string;
}

// ============================================
// SUB-AGENT PROCESS MANAGER
// ============================================

/**
 * Sub-Agent Process Manager
 *
 * Spawns and manages sub-agent child processes for true parallel execution.
 *
 * @example
 * ```typescript
 * const manager = new SubAgentProcessManager({
 *   projectPath: '/workspace',
 *   parentSessionId: 'session-123',
 *   defaultModelId: 'claude-sonnet-4-5',
 * });
 *
 * // Spawn multiple agents in parallel
 * const [result1, result2] = await Promise.all([
 *   manager.spawnAgent(agentDef1, 'Task 1'),
 *   manager.spawnAgent(agentDef2, 'Task 2'),
 * ]);
 * ```
 */
export class SubAgentProcessManager implements ISubAgentManager {
  private config: SubAgentProcessManagerConfig;
  private activeAgents: Map<string, AgentProcessState> = new Map();
  private completedAgents: Map<string, SubAgentResult> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();
  private agentModulePath: string;

  // Tmux visual monitoring
  private tmuxMonitorEnabled: boolean;
  private currentTeamSession: string | null = null;
  private agentPaneMap: Map<string, number> = new Map();
  private tmuxAvailable: boolean | null = null; // null = not checked yet

  constructor(config: SubAgentProcessManagerConfig) {
    this.config = {
      maxConcurrentAgents: 5,
      debug: false,
      ...config,
    };

    // Resolve path to agent-mode.js
    // When built, this will be in packages/cli/dist/agent-mode.js
    this.agentModulePath = config.agentModulePath ?? this.resolveAgentModulePath();
    this.tmuxMonitorEnabled = process.env.AGENT_TMUX_MONITOR === 'true';

    if (this.config.debug) {
      console.log(`[SubAgentProcessManager] Initialized with agent module: ${this.agentModulePath}`);
    }
  }

  /**
   * Resolve the path to the agent-mode.js module
   */
  private resolveAgentModulePath(): string {
    // Try to find it relative to this file
    // This file is in packages/core/dist/orchestrator/
    // Agent mode is in packages/cli/dist/agent-mode.js
    try {
      const thisDir = dirname(fileURLToPath(import.meta.url));
      // Go up from core/dist/orchestrator to monorepo root, then to cli/dist
      const cliDist = join(thisDir, '..', '..', '..', 'cli', 'dist', 'agent-mode.js');
      return cliDist;
    } catch {
      // Fallback - assume we're in the right place
      return join(process.cwd(), 'packages', 'cli', 'dist', 'agent-mode.js');
    }
  }

  /**
   * Spawn a new sub-agent as a child process
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
    const modelId = options.modelOverride ?? agentDefinition.model ?? this.config.defaultModelId;

    if (this.config.debug) {
      console.log(`[SubAgentProcessManager] Spawning agent: ${agentDefinition.name} (${agentId})`);
    }

    // Create promise that will be resolved when agent completes
    let resolvePromise: (result: SubAgentResult) => void;
    let rejectPromise: (error: Error) => void;

    const promise = new Promise<SubAgentResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    // Fork the child process. envOverrides apply per-fork, so a parent can
    // grant the subagent capabilities it doesn't grant itself (e.g. Browse
    // subagent enables MCP_AUTO_INJECT to receive nexus-browser tools without
    // polluting the parent's context).
    const childProcess = fork(this.agentModulePath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ...(options.envOverrides || {}),
        CORTEX_AGENT_MODE: 'true',
        CORTEX_AGENT_ID: agentId,
      },
    });

    // Create state
    const state: AgentProcessState = {
      agentId,
      agentName: agentDefinition.name,
      modelId,
      process: childProcess,
      startTime: new Date(),
      status: 'starting',
      promise,
      resolve: resolvePromise!,
      reject: rejectPromise!,
      toolUseId: options.toolUseId,
    };

    this.activeAgents.set(agentId, state);

    // Set up tmux monitoring pane (if enabled)
    await this.setupTmuxPane(agentId, agentDefinition.name);

    // Set up message handling
    this.setupProcessHandlers(state, agentDefinition, taskPrompt, options);

    // Wait for ready signal, then send start message
    // The process will send 'ready' when it's initialized

    return promise;
  }

  /**
   * Set up handlers for child process events
   */
  private setupProcessHandlers(
    state: AgentProcessState,
    agentDefinition: AgentDefinition,
    taskPrompt: string,
    options: SpawnAgentOptions
  ): void {
    const { process: childProcess, agentId } = state;

    // Handle IPC messages from child
    childProcess.on('message', (message: ChildToParentMessage) => {
      this.handleChildMessage(state, message, agentDefinition, taskPrompt, options);
    });

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      if (this.config.debug) {
        console.log(`[SubAgentProcessManager] Agent ${agentId} exited: code=${code}, signal=${signal}`);
      }

      // If we haven't received a completion message, treat as error
      if (state.status === 'starting' || state.status === 'running') {
        const error = new Error(`Agent process exited unexpectedly: code=${code}, signal=${signal}`);
        state.status = 'error';
        state.reject(error);
      }

      // Clean up
      this.activeAgents.delete(agentId);
    });

    // Handle process errors
    childProcess.on('error', (error) => {
      console.error(`[SubAgentProcessManager] Agent ${agentId} process error:`, error);
      state.status = 'error';
      state.reject(error);
      this.activeAgents.delete(agentId);
    });

    // Capture stdout/stderr for future monitoring feature
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data: Buffer) => {
        if (this.config.debug) {
          console.log(`[Agent ${state.agentName}] ${data.toString()}`);
        }
        this.eventEmitter.emit('agent:stdout', { agentId, data: data.toString() });
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data: Buffer) => {
        if (this.config.debug) {
          console.error(`[Agent ${state.agentName}] ${data.toString()}`);
        }
        this.eventEmitter.emit('agent:stderr', { agentId, data: data.toString() });
      });
    }
  }

  /**
   * Handle messages from child process
   */
  private handleChildMessage(
    state: AgentProcessState,
    message: ChildToParentMessage,
    agentDefinition: AgentDefinition,
    taskPrompt: string,
    options: SpawnAgentOptions
  ): void {
    const { agentId, process: childProcess } = state;

    switch (message.type) {
      case 'ready':
        // Child is ready, send start message
        if (this.config.debug) {
          console.log(`[SubAgentProcessManager] Agent ${agentId} ready (PID: ${message.payload.pid})`);
        }

        const startMessage: IPCStartMessage = {
          type: 'start',
          payload: {
            agentId,
            agentDefinition,
            taskPrompt,
            modelId: state.modelId,
            projectPath: this.config.projectPath,
            timeoutMs: options.timeoutMs ?? 300000,
            maxTurns: options.maxTurns ?? 50,
            debug: this.config.debug,
          },
        };

        sendToChild(childProcess, startMessage);
        break;

      case 'started':
        state.status = 'running';
        this.eventEmitter.emit('agent:started', message.payload);
        this.mirrorToTmux(agentId, `▶ Started (model: ${state.modelId})`);
        break;

      case 'progress':
        this.eventEmitter.emit('agent:progress', message.payload);
        break;

      case 'tool_call':
        this.eventEmitter.emit('agent:tool_call', message.payload);
        this.mirrorToTmux(agentId, ` ${message.payload.toolName}`);
        break;

      case 'tool_result':
        this.eventEmitter.emit('agent:tool_result', message.payload);
        break;

      case 'thinking':
        this.eventEmitter.emit('agent:thinking', message.payload);
        break;

      case 'text':
        this.eventEmitter.emit('agent:text', message.payload);
        break;

      case 'error':
        if (this.config.debug) {
          console.error(`[SubAgentProcessManager] Agent ${agentId} error:`, message.payload.message);
        }
        this.eventEmitter.emit('agent:error', {
          agentId,
          agentName: state.agentName,
          error: new Error(message.payload.message),
        });
        this.mirrorToTmux(agentId, `[ERROR] Error: ${message.payload.message}`);
        break;

      case 'completed':
        state.status = 'completed';
        this.completedAgents.set(agentId, message.payload.result);
        // R30: Persist result durably BEFORE resolving the promise.
        // If the parent is ESC-aborted after this point, the result survives on disk.
        if (state.toolUseId) {
          this.persistSubAgentResult(state.toolUseId, message.payload.result);
        }
        this.activeAgents.delete(agentId);
        state.resolve(message.payload.result);
        this.eventEmitter.emit('agent:completed', message.payload);
        this.mirrorToTmux(agentId, `[OK] Completed (${message.payload.result?.durationMs || 0}ms)`);
        break;

      case 'interrupted':
        state.status = 'interrupted';
        this.eventEmitter.emit('agent:interrupted', message.payload);
        break;

      case 'timeout':
        state.status = 'timeout';
        this.eventEmitter.emit('agent:timeout', message.payload);
        break;

      case 'log':
        if (this.config.debug || message.payload.level === 'error') {
          console.log(`[Agent ${state.agentName}] [${message.payload.level}] ${message.payload.message}`);
        }
        break;

      case 'permission_request':
        // Sub-agent is requesting permission for a tool operation
        // Forward to the parent's approval handler and send response back
        this.handlePermissionRequest(state, message as IPCPermissionRequestMessage);
        break;

      default:
        if (this.config.debug) {
          console.log(`[SubAgentProcessManager] Unknown message type: ${(message as { type: string }).type}`);
        }
    }
  }

  /**
   * Handle permission request from child process
   * Forwards the request to the parent's approval handler and sends response back
   */
  private async handlePermissionRequest(
    state: AgentProcessState,
    message: IPCPermissionRequestMessage
  ): Promise<void> {
    const { payload } = message;
    const { agentId, process: childProcess } = state;

    if (this.config.debug) {
      console.log(
        `[SubAgentProcessManager] Permission request from ${agentId}: ` +
        `${payload.toolName} - ${payload.reason}`
      );
    }

    // Emit event so UI can show the request details
    this.eventEmitter.emit('agent:permission_request', {
      agentId,
      agentName: state.agentName,
      requestId: payload.requestId,
      toolName: payload.toolName,
      toolInput: payload.toolInput,
      reason: payload.reason,
      timestamp: payload.timestamp,
    });

    let approved = false;

    if (this.config.approvalHandler) {
      try {
        // Forward to parent's approval handler (shows UI to user with full tool details)
        approved = await this.config.approvalHandler.requestApproval({
          toolName: payload.toolName,
          toolInput: payload.toolInput,
          reason: `[Sub-Agent: ${state.agentName}] ${payload.reason}`,
          timestamp: new Date(payload.timestamp),
        });
      } catch (error) {
        if (this.config.debug) {
          console.error(`[SubAgentProcessManager] Approval handler error:`, error);
        }
        approved = false;
      }
    } else {
      // No approval handler configured - deny by default for safety
      if (this.config.debug) {
        console.log(`[SubAgentProcessManager] No approval handler configured, denying request`);
      }
      approved = false;
    }

    // Send response back to child
    sendToChild(childProcess, {
      type: 'permission_response',
      payload: {
        requestId: payload.requestId,
        approved,
        reason: approved ? 'User approved' : 'User denied or no handler configured',
      },
    });

    // Emit result event
    this.eventEmitter.emit('agent:permission_response', {
      agentId,
      requestId: payload.requestId,
      approved,
    });
  }

  /**
   * Generate a unique agent ID
   */
  private generateAgentId(agentName: string): string {
    const shortId = uuidv4().split('-')[0];
    return `${agentName}-${shortId}`;
  }

  // ============================================
  // CONTROL METHODS
  // ============================================

  /**
   * Pause a running agent
   */
  pauseAgent(agentId: string): boolean {
    const state = this.activeAgents.get(agentId);
    if (!state) return false;

    sendToChild(state.process, { type: 'pause' });
    this.eventEmitter.emit('agent:paused', { agentId });
    return true;
  }

  /**
   * Resume a paused agent
   */
  resumeAgent(agentId: string): boolean {
    const state = this.activeAgents.get(agentId);
    if (!state) return false;

    sendToChild(state.process, { type: 'resume' });
    this.eventEmitter.emit('agent:resumed', { agentId });
    return true;
  }

  /**
   * Interrupt (abort) a running agent
   */
  interruptAgent(agentId: string, reason: string): boolean {
    const state = this.activeAgents.get(agentId);
    if (!state) return false;

    sendToChild(state.process, { type: 'abort', payload: { reason } });

    // Give it a moment to clean up, then force kill
    setTimeout(() => {
      if (state.process.connected) {
        state.process.kill('SIGTERM');
      }
    }, 5000);

    return true;
  }

  /**
   * Send guidance message to a running agent
   */
  async guideAgent(agentId: string, message: string): Promise<boolean> {
    const state = this.activeAgents.get(agentId);
    if (!state) return false;

    sendToChild(state.process, { type: 'guidance', payload: { message } });
    return true;
  }

  /**
   * Broadcast guidance to all active agents, optionally excluding one.
   * Used for cross-agent communication — when one agent completes or produces
   * findings, the orchestrator can forward them to still-running siblings.
   *
   * @param message The guidance text to broadcast
   * @param excludeAgentId Optional agent ID to exclude (e.g., the sender)
   */
  broadcastGuidance(message: string, excludeAgentId?: string): void {
    for (const agentId of this.activeAgents.keys()) {
      if (agentId !== excludeAgentId) {
        this.guideAgent(agentId, message);
      }
    }
  }


  // ============================================
  // TMUX VISUAL MONITORING
  // ============================================

  /**
   * Get the tmux binary path, respecting TMUX_BIN env var.
   */
  private get tmuxBin(): string {
    return process.env.TMUX_BIN || 'tmux';
  }

  /**
   * Check if tmux is available on the system (cached).
   */
  private isTmuxAvailable(): boolean {
    if (this.tmuxAvailable === null) {
      try {
        execSync(`${this.tmuxBin} -V`, { stdio: 'pipe' });
        this.tmuxAvailable = true;
      } catch {
        this.tmuxAvailable = false;
      }
    }
    return this.tmuxAvailable;
  }

  /**
   * Set up a tmux pane for a new agent (if monitoring is enabled).
   * Creates a tmux session on first agent, splits into panes for subsequent agents.
   */
  private async setupTmuxPane(agentId: string, agentName: string): Promise<void> {
    if (!this.tmuxMonitorEnabled || !this.isTmuxAvailable()) return;

    try {
      const dispatchId = uuidv4().split('-')[0];
      const teamSession = this.currentTeamSession || `team-${dispatchId}`;

      // Check if session exists
      let sessionExists = false;
      try {
        execSync(`${this.tmuxBin} has-session -t "${teamSession}" 2>/dev/null`, { stdio: 'pipe' });
        sessionExists = true;
      } catch { /* session doesn't exist */ }

      if (!sessionExists) {
        // Create new session for the team
        execSync(`${this.tmuxBin} new-session -d -s "${teamSession}" -x 200 -y 50`, { stdio: 'pipe' });
        execSync(`${this.tmuxBin} send-keys -t "${teamSession}" "echo ' Agent Team Monitor — ${teamSession}'" Enter`, { stdio: 'pipe' });
        this.currentTeamSession = teamSession;
      } else {
        // Split window for additional agents
        execSync(`${this.tmuxBin} split-window -t "${teamSession}" -v`, { stdio: 'pipe' });
        execSync(`${this.tmuxBin} select-layout -t "${teamSession}" tiled`, { stdio: 'pipe' });
      }

      // Send agent header to the pane
      const paneIndex = this.agentPaneMap.size;
      this.agentPaneMap.set(agentId, paneIndex);

      const paneTarget = `${teamSession}.${paneIndex}`;
      execSync(`${this.tmuxBin} send-keys -t "${paneTarget}" "echo '━━━ Agent: ${agentName} (${agentId}) ━━━'" Enter`, { stdio: 'pipe' });

      if (this.config.debug) {
        console.log(`[SubAgentProcessManager] Tmux pane ${paneIndex} created for agent ${agentName}`);
      }
    } catch (error: any) {
      if (this.config.debug) {
        console.log(`[SubAgentProcessManager] Tmux monitor setup failed (non-critical): ${error.message}`);
      }
    }
  }

  /**
   * Mirror an agent event to its tmux pane.
   */
  private mirrorToTmux(agentId: string, eventText: string): void {
    if (!this.tmuxMonitorEnabled || !this.currentTeamSession) return;

    const paneIndex = this.agentPaneMap.get(agentId);
    if (paneIndex === undefined) return;

    try {
      // Escape single quotes for shell
      const escaped = eventText.replace(/'/g, "'\\''").substring(0, 200);
      const paneTarget = `${this.currentTeamSession}.${paneIndex}`;
      execSync(`${this.tmuxBin} send-keys -t "${paneTarget}" "echo '${escaped}'" Enter`, { stdio: 'pipe' });
    } catch {
      // Non-critical — tmux pane may have been closed
    }
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
   * Wait for all active agents to complete
   */
  async waitForAll(): Promise<SubAgentResult[]> {
    const promises = Array.from(this.activeAgents.values()).map((s) => s.promise);
    return Promise.all(promises);
  }

  // ============================================
  // STATUS METHODS
  // ============================================

  /**
   * Get event emitter for subscribing to agent events
   */
  getEventEmitter(): ISubAgentEventEmitter {
    return this.eventEmitter as ISubAgentEventEmitter;
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
    status: AgentProcessState['status'];
    elapsedMs: number;
    agentName: string;
    pid?: number;
  } | null {
    const state = this.activeAgents.get(agentId);
    if (!state) return null;

    return {
      isActive: true,
      status: state.status,
      elapsedMs: Date.now() - state.startTime.getTime(),
      agentName: state.agentName,
      pid: state.process.pid,
    };
  }

  /**
   * Get result of a completed agent
   */
  getCompletedResult(agentId: string): SubAgentResult | null {
    return this.completedAgents.get(agentId) ?? null;
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
      status: AgentProcessState['status'];
      elapsedMs: number;
      pid?: number;
    }>;
  } {
    const agents: Array<{
      id: string;
      name: string;
      status: AgentProcessState['status'];
      elapsedMs: number;
      pid?: number;
    }> = [];

    // Add active agents
    for (const [id, state] of this.activeAgents) {
      agents.push({
        id,
        name: state.agentName,
        status: state.status,
        elapsedMs: Date.now() - state.startTime.getTime(),
        pid: state.process.pid,
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

  /**
   * Cleanup - kill all processes
   */
  async cleanup(): Promise<void> {
    this.interruptAll('Manager cleanup');

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Force kill any remaining
    for (const state of this.activeAgents.values()) {
      if (state.process.connected) {
        state.process.kill('SIGKILL');
      }
    }

    this.activeAgents.clear();
  }

  // ============================================
  // R30: DURABLE SUB-AGENT RESULT PERSISTENCE
  // ============================================

  private getSubagentStoreDir(): string {
    const sessionDir = process.env.SESSION_STORAGE_DIR || '.cortex/sessions';
    const root = process.env.PROJECT_ROOT || this.config.projectPath || process.cwd();
    return join(root, sessionDir, `${this.config.parentSessionId}.subagents`);
  }

  private persistSubAgentResult(toolUseId: string, result: SubAgentResult): void {
    try {
      const dir = this.getSubagentStoreDir();
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${toolUseId}.json`);
      writeFileSync(filePath, JSON.stringify(result), 'utf-8');
      if (this.config.debug) {
        console.log(`[SubAgentProcessManager] Persisted result for tool_use_id=${toolUseId}`);
      }
    } catch (err: unknown) {
      console.warn('[SubAgentProcessManager] Failed to persist sub-agent result:', (err as Error)?.message);
    }
  }

  /**
   * Look up a durably persisted sub-agent result by tool_use_id.
   * Used by validateAndRepairMessages to recover ESC-orphaned work.
   */
  static loadPersistedResult(
    sessionId: string,
    toolUseId: string,
    projectRoot?: string,
  ): SubAgentResult | null {
    try {
      const sessionDir = process.env.SESSION_STORAGE_DIR || '.cortex/sessions';
      const root = projectRoot || process.env.PROJECT_ROOT || process.cwd();
      const filePath = join(root, sessionDir, `${sessionId}.subagents`, `${toolUseId}.json`);
      if (!existsSync(filePath)) return null;
      return JSON.parse(readFileSync(filePath, 'utf-8')) as SubAgentResult;
    } catch {
      return null;
    }
  }
}

/**
 * Factory function to create a SubAgentProcessManager
 */
export function createSubAgentProcessManager(
  projectPath: string,
  parentSessionId: string,
  defaultModelId: string,
  options?: Partial<SubAgentProcessManagerConfig>
): SubAgentProcessManager {
  return new SubAgentProcessManager({
    projectPath,
    parentSessionId,
    defaultModelId,
    ...options,
  });
}
