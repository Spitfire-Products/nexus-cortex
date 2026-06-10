/**
 * Sub-Agent Type Definitions
 *
 * Core types for the Task Agent sub-agent spawning system.
 * These types define the contracts between parent orchestrator,
 * child orchestrators, and the event/result systems.
 *
 * @module orchestrator/SubAgentTypes
 * @version 1.0.0
 */

/**
 * Approval mode type (matches CortexOrchestrator's internal type)
 */
export type ApprovalMode = 'inherit' | 'auto' | 'manual';

/**
 * Agent permission mode - determines how tool approvals are handled
 *
 * - 'interactive': Prompt user for approval (default, safest)
 * - 'auto-approve': Auto-approve allowed tools (for trusted agents)
 * - 'deny-all': Block all tools requiring approval
 */
export type AgentPermissionMode = 'interactive' | 'auto-approve' | 'deny-all';

/**
 * Tool permission level for agent-specific permissions
 *
 * - 'whitelist': Tool is always allowed without approval
 * - 'graylist': Tool requires user approval or auto-approval setting
 * - 'blacklist': Tool is blocked and requires explicit override
 */
export type ToolPermissionLevel = 'whitelist' | 'graylist' | 'blacklist';

/**
 * Agent permission configuration
 *
 * Defines how an agent handles tool permissions independently of parent session.
 * IMPORTANT: Agent permissions do NOT inherit from parent session permissions.
 */
export interface AgentPermissions {
  /**
   * Default permission mode for tools not explicitly configured
   * @default 'interactive'
   */
  defaultMode: AgentPermissionMode;

  /**
   * Tool-specific permission levels
   * Key is tool name (case-insensitive), value is permission level
   */
  toolLevels?: Record<string, ToolPermissionLevel>;

  /**
   * Whitelisted tools (always allowed without approval)
   * Shorthand for setting toolLevels[tool] = 'whitelist'
   */
  whitelist?: string[];

  /**
   * Graylisted tools (require approval based on defaultMode)
   * Shorthand for setting toolLevels[tool] = 'graylist'
   */
  graylist?: string[];

  /**
   * Blacklisted tools (blocked, require explicit override)
   * Shorthand for setting toolLevels[tool] = 'blacklist'
   */
  blacklist?: string[];

  /**
   * Whether to allow execution tools (Bash, etc.) at all
   * If false, execution tools are implicitly blacklisted
   * @default true
   */
  allowExecutionTools?: boolean;
}

/**
 * Agent definition loaded from .cortex/agents/*.md files
 */
export interface AgentDefinition {
  /** Agent identifier (alphanumeric + hyphens, max 64 chars) */
  name: string;

  /** Description of when to use this agent */
  description: string;

  /** Agent's system prompt (content after frontmatter) */
  systemPrompt: string;

  /** Allowed tools - list of tool names or 'all' */
  tools: string[] | 'all';

  /** Model preference - 'inherit', alias, or full model ID */
  model: string;

  /** Where the agent was loaded from ('builtin' = shipped with the install) */
  location: 'project' | 'personal' | 'builtin';

  /** Full path to the agent's .md file */
  filePath: string;

  /**
   * Agent-specific permission configuration
   *
   * IMPORTANT: This does NOT inherit from parent session.
   * If not specified, defaults to 'interactive' mode (prompts user).
   * Execution tools (Bash, etc.) default to graylist (require approval).
   */
  permissions?: AgentPermissions;
}

/**
 * Configuration for creating a sub-agent
 */
export interface SubAgentConfig {
  /** Unique identifier for this sub-agent instance */
  agentId: string;

  /** Agent definition from TaskToolExecutor */
  agentDefinition: AgentDefinition;

  /** Task prompt from user */
  taskPrompt: string;

  /** Resolved model ID (after alias resolution) */
  modelId: string;

  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs?: number;

  /** Maximum turns before forced completion */
  maxTurns?: number;
}

/**
 * Context passed from parent to child orchestrator
 */
export interface SubAgentContext {
  /** Parent's session ID for correlation */
  parentSessionId: string;

  /** Parent's turn number when sub-agent was spawned */
  parentTurnNumber: number;

  /** Event emitter for streaming to parent */
  eventEmitter: ISubAgentEventEmitter;

  /** Abort controller for interruption */
  abortController: AbortController;

  /** Pause controller for suspension */
  pauseController: IPauseController;

  /** Parent's approval mode */
  approvalMode: ApprovalMode;
}

/**
 * Pause controller interface
 */
export interface IPauseController {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  waitIfPaused(): Promise<void>;
}

/**
 * Sub-agent event emitter interface
 */
export interface ISubAgentEventEmitter {
  emit<K extends keyof SubAgentEvents>(event: K, data: SubAgentEvents[K]): boolean;
  on<K extends keyof SubAgentEvents>(event: K, listener: (data: SubAgentEvents[K]) => void): this;
  once<K extends keyof SubAgentEvents>(event: K, listener: (data: SubAgentEvents[K]) => void): this;
  off<K extends keyof SubAgentEvents>(event: K, listener: (data: SubAgentEvents[K]) => void): this;
}

/**
 * Tool usage statistics
 */
export interface ToolUsageSummary {
  /** Tool name */
  name: string;

  /** Number of times tool was called */
  callCount: number;

  /** Total execution time in milliseconds */
  totalDuration: number;

  /** Number of errors */
  errors: number;
}

/**
 * Cost metrics for sub-agent execution
 */
export interface SubAgentCostMetrics {
  /** Input tokens used */
  inputTokens: number;

  /** Output tokens generated */
  outputTokens: number;

  /** Estimated cost in USD */
  estimatedCost: number;

  /** Number of cache hits */
  cacheHits: number;
}

/**
 * Error details for failed sub-agents
 */
export interface SubAgentErrorDetails {
  /** Error message */
  message: string;

  /** Error type/name */
  type: string;

  /** Stack trace (if available) */
  stack?: string;
}

/**
 * Artifact produced by sub-agent
 */
export interface SubAgentArtifact {
  /** Artifact type */
  type: 'code' | 'report' | 'data' | 'visualization' | 'file';

  /** File path (if saved to disk) */
  path?: string;

  /** Inline content (if not saved) */
  content?: string;

  /** MIME type */
  mimeType?: string;
}

/**
 * Result returned by completed sub-agent
 */
export interface SubAgentResult {
  // ─────────────────────────────────────────────────────────────────
  // Identification
  // ─────────────────────────────────────────────────────────────────

  /** Unique identifier for this sub-agent instance */
  agentId: string;

  /** Agent name from definition */
  agentName: string;

  /** Model used for execution */
  model: string;

  // ─────────────────────────────────────────────────────────────────
  // Execution Metadata
  // ─────────────────────────────────────────────────────────────────

  /** When execution started */
  startTime: Date;

  /** When execution ended */
  endTime: Date;

  /** Total duration in milliseconds */
  durationMs: number;

  /** Number of conversation turns */
  turnCount: number;

  // ─────────────────────────────────────────────────────────────────
  // Status
  // ─────────────────────────────────────────────────────────────────

  /** Final status */
  status: 'completed' | 'interrupted' | 'error' | 'timeout';

  // ─────────────────────────────────────────────────────────────────
  // Content
  // ─────────────────────────────────────────────────────────────────

  /** Brief summary for parent LLM */
  summary: string;

  /** Complete response text */
  fullResponse: string;

  /** Parsed structured data (if applicable) */
  structuredData?: Record<string, unknown>;

  // ─────────────────────────────────────────────────────────────────
  // Tool Usage
  // ─────────────────────────────────────────────────────────────────

  /** Statistics per tool */
  toolsUsed: ToolUsageSummary[];

  // ─────────────────────────────────────────────────────────────────
  // Files
  // ─────────────────────────────────────────────────────────────────

  /** Files read during execution */
  filesRead: string[];

  /** Files modified during execution */
  filesModified: string[];

  // ─────────────────────────────────────────────────────────────────
  // Cost
  // ─────────────────────────────────────────────────────────────────

  /** Token usage and cost metrics */
  cost: SubAgentCostMetrics;

  // ─────────────────────────────────────────────────────────────────
  // Error (if applicable)
  // ─────────────────────────────────────────────────────────────────

  /** Error details for failed executions */
  error?: SubAgentErrorDetails;

  // ─────────────────────────────────────────────────────────────────
  // Artifacts
  // ─────────────────────────────────────────────────────────────────

  /** Artifacts produced by the agent */
  artifacts?: SubAgentArtifact[];
}

/**
 * Events emitted by sub-agents
 *
 * These events allow parent orchestrators and CLI components
 * to monitor sub-agent progress in real-time.
 */
export interface SubAgentEvents {
  /**
   * Emitted when a sub-agent starts execution
   */
  'agent:started': {
    agentId: string;
    agentName: string;
    model: string;
    task: string;
    parentSessionId: string;
  };

  /**
   * Emitted periodically to report progress
   */
  'agent:progress': {
    agentId: string;
    turnNumber: number;
    totalTokens: number;
    elapsedMs: number;
  };

  /**
   * Emitted when a tool is called
   */
  'agent:tool_call': {
    agentId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolId: string;
  };

  /**
   * Emitted when a tool returns a result
   */
  'agent:tool_result': {
    agentId: string;
    toolName: string;
    toolId: string;
    success: boolean;
    summary: string;
    durationMs: number;
  };

  /**
   * Emitted when thinking/reasoning is generated
   */
  'agent:thinking': {
    agentId: string;
    thinkingText: string;
  };

  /**
   * Emitted when text is generated
   */
  'agent:text': {
    agentId: string;
    text: string;
    isFinal: boolean;
  };

  /**
   * Emitted when a tool requires user approval
   */
  'agent:approval_required': {
    agentId: string;
    agentName: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    reason: string;
  };

  /**
   * Emitted when sub-agent completes successfully
   */
  'agent:completed': {
    agentId: string;
    result: SubAgentResult;
  };

  /**
   * Emitted when sub-agent encounters an error
   */
  'agent:error': {
    agentId: string;
    agentName: string;
    error: Error;
  };

  /**
   * Emitted when sub-agent is interrupted by user
   */
  'agent:interrupted': {
    agentId: string;
    reason: string;
  };

  /**
   * Emitted when sub-agent is paused
   */
  'agent:paused': {
    agentId: string;
  };

  /**
   * Emitted when sub-agent is resumed
   */
  'agent:resumed': {
    agentId: string;
  };

  /**
   * Emitted when sub-agent times out
   */
  'agent:timeout': {
    agentId: string;
    timeoutMs: number;
    elapsedMs: number;
  };
}

/**
 * Options for spawning a sub-agent
 */
export interface SpawnAgentOptions {
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs?: number;

  /** Maximum turns before forced completion */
  maxTurns?: number;

  /** Override model (ignores agent definition) */
  modelOverride?: string;

  /** Additional context to inject */
  additionalContext?: string;

  /**
   * Environment variable overrides applied when forking the child process.
   *
   * Used to give a subagent capabilities its parent doesn't expose. The
   * canonical use case is the Browse subagent: parent runs with
   * `MCP_AUTO_INJECT=false` (so 43 nexus-browser tools don't bloat its
   * context), but the spawned browse subagent needs them — it overrides
   * `MCP_AUTO_INJECT=true` for its own forked process only.
   *
   * Override semantics: shallow merge over `process.env`. Pass `''` (empty
   * string) to unset rather than `undefined`.
   */
  envOverrides?: Record<string, string>;

  /**
   * The tool_use_id from the parent's dispatching tool call (Task, Browse, etc.).
   *
   * When provided, the process manager writes the completed SubAgentResult to
   * a durable store keyed by this ID. If the parent turn is interrupted (ESC),
   * the orphan recovery in validateAndRepairMessages can inject the real result
   * instead of a generic "was interrupted" error.
   */
  toolUseId?: string;
}

/**
 * Sub-agent manager interface
 */
export interface ISubAgentManager {
  /**
   * Spawn a new sub-agent to execute a task
   */
  spawnAgent(
    agentDefinition: AgentDefinition,
    taskPrompt: string,
    options?: SpawnAgentOptions
  ): Promise<SubAgentResult>;

  /**
   * Pause a running agent
   * @returns true if agent was found and paused
   */
  pauseAgent(agentId: string): boolean;

  /**
   * Resume a paused agent
   * @returns true if agent was found and resumed
   */
  resumeAgent(agentId: string): boolean;

  /**
   * Interrupt (abort) a running agent
   * @returns true if agent was found and interrupted
   */
  interruptAgent(agentId: string, reason: string): boolean;

  /**
   * Send guidance message to running agent
   * @returns true if agent was found and message was injected
   */
  guideAgent(agentId: string, message: string): Promise<boolean>;

  /**
   * Get event emitter for subscribing to agent events
   */
  getEventEmitter(): ISubAgentEventEmitter;

  /**
   * Get list of active agent IDs
   */
  getActiveAgentIds(): string[];

  /**
   * Check if an agent is currently active
   */
  isAgentActive(agentId: string): boolean;
}
