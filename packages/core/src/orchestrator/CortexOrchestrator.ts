/**
 * Cortex Orchestrator - Phase 2.1
 * Central Coordination Layer with Real API Integration
 *
 * Phase 2.0: Basic structure [OK]
 * Phase 2.1: Real API calls, GatewayTranslationLayer, ModelRegistry ⚙
 *
 * Based on: docs/v4-core_library/Orchestrator_ARCHITECTURE.md
 */

import { v4 as uuidv4 } from 'uuid';

// Phase 1.5 Week 1: Multi-Provider
import { AdapterRegistry } from '../adapters/AdapterRegistry.js';
import { GatewayTranslationLayer } from '../adapters/GatewayTranslationLayer.js';
import { ToolNamingHandler } from '../adapters/ToolNamingHandler.js';
import type { ModelConfig } from '../models/ModelConfig.interface.js';
import type { CanonicalMessage } from '../adapters/FormatAdapter.interface.js';

// Phase 2.4: Server-Side Tools Support
import { shouldUseServerSideTools, isServerSideToolsEnabled, modelSupportsServerSideTools, type ServerSideToolDetectionResult } from '../adapters/ServerSideToolDetection.js';
import { shouldAutoInjectMcp } from './mcpAutoInjectPolicy.js';
import { verifyCitationsGrounded } from './citationVerification.js';
import { verifyCoordinates, deterministicCoordinateScore } from './coordinateVerification.js';
import { buildRouterSample, appendJsonlRotating } from './cortexTrainingRecord.js';
import { join as pathJoin } from 'path';
import { existsSync } from 'fs';
import { type ServerSideToolMetadata, extractServerSideMetadata, XAIServerSideTools, OpenAIServerSideTools, toCanonicalTool } from '../tools/ServerSideTools.js';

// Message types
import type { Message } from '../session/MessageTypes.js';

// Phase 2.1: API Client and Model Registry
import { APIClient, type StreamChunk } from './APIClient.js';
import { ModularModelRegistry } from '../models/registry/ModularModelRegistry.js';
import { ModelAliasResolver } from '../models/registry/ModelAliasResolver.js';

// Phase 2.2.1: Timeline and History Storage
import { SessionTimeline } from '../session/SessionTimeline.js';
import { JSONLHistoryStore } from '../session/JSONLHistoryStore.js';
import { ErrorDetector } from '../utils/ErrorDetector.js';

// Phase 2.2.4: Checkpoint Management
import { CheckpointManager, type CheckpointOptions, type ResumeOptions } from '../session/CheckpointManager.js';
import type { Checkpoint } from '../session/SessionTimeline.js';
import { FileCheckpointManager } from '../file-tracking/FileCheckpointManager.js';

// Phase 2.2.5: Historical Retrieval
import { HistoricalContextService } from '../tools/historical/HistoricalContextService.js';

// Phase 2.7: Cache Metrics Tracking
import { CacheMetricsAccumulator } from '../session/CacheMetricsAccumulator.js';

// Phase 2: System Messages
import { SystemReminderInjector } from '../system-messages/SystemReminderInjector.js';
import { SystemMessageLoader } from '../system-messages/SystemMessageLoader.js';

// Sub-Agent System (Process-based for true parallelism)
import { SubAgentProcessManager, createSubAgentProcessManager } from './SubAgentProcessManager.js';
import type { AgentDefinition, SubAgentResult, ISubAgentEventEmitter } from './SubAgentTypes.js';

// Phase 1: Tool Architecture Refactor - Unified Tool Registry
import { toolFactory } from '../tools/ToolFactory.js';

// Phase 2.9: MCP Integration
import { McpClientManager } from '../mcp/index.js';
import { slashCommandRegistry } from '../commands/SlashCommandRegistry.js';
import { McpConfigManager } from '../mcp/McpConfigManager.js';
import { McpServerRegistry } from '../mcp/McpServerRegistry.js';
import { prefixMcpToolName, parseMcpToolName } from '../mcp/mcpToolNamespacing.js';
import { DecisionStore, stableInputHash } from '../training/DecisionStore.js';
import { formatPriorReminder } from '../training/DecisionPriorInjector.js';
import { ModelRouterMatrix } from '../training/ModelRouterMatrix.js';
import { classifyTask } from '../training/TaskClassifier.js';
import { closestToolMatches } from './toolNameMatcher.js';
import { classifyApiError } from './apiErrorClassifier.js';
import { pinStaticSystemPrompt } from './staticSystemPromptPin.js';
import { hasVisibleAssistantText, shouldForceSynthesis } from './assistantTextPresence.js';
import { computeToolBudgetSignal, isToolProgressStalled } from './toolBudgetSignal.js';

// Phase 2.6: MCP Model Management Tools
import {
  ListAvailableMcpServers,
  SearchMcpServers,
  GetMcpConfig,
  EnableMcpServer,
  DisableMcpServer,
  ConfigureMcpServer,
  InitMcpConfig
} from '../tools/mcp-management/index.js';

// Context Management Tools
import { InitCortexContext } from '../tools/context-management/index.js';

// Phase 2.2.1: Context Management
import { ContextBudgetManager } from '../conversation/ContextBudgetManager.js';

// Phase 2.5: Tool Execution Integration
import type { ExecutorRegistry } from '@nexus-cortex/types';

// Phase 2.2.3: Helper Model Middleware
import { HelperModelMiddleware } from '../middleware/HelperModelMiddleware.js';
import { StoredCompactionManager } from '../conversation/StoredCompactionManager.js';

// Wave 3: Middleware Components
import { ErrorClassificationMiddleware } from '../middleware/ErrorClassificationMiddleware.js';
import { RetryMiddleware } from '../middleware/RetryMiddleware.js';
import { PermissionsMiddleware } from '../middleware/PermissionsMiddleware.js';
import { SystemMessageMiddleware } from '../middleware/SystemMessageMiddleware.js';
import { MentorshipMiddleware } from '../middleware/MentorshipMiddleware.js';

// PTC: Progressive tool loading for non-PTC providers
import { ClientSideToolFilter } from '../tools/ClientSideToolFilter.js';
import type {
  MiddlewareContext,
  MentorshipToolResult,
  PermissionPolicy,
  PermissionAuditEntry,
  ApprovalHandler
} from '../middleware/contracts/MiddlewareContracts.js';

/**
 * Orchestrator Configuration
 */
export interface OrchestratorConfig {
  /** Default model to use if not specified */
  defaultModelId: string;

  /** Project path for file operations */
  projectPath: string;

  /**
   * Path to a file that REPLACES the core `system_prompt` system message
   * (`messages/SYSTEM_PROMPT.md`) — from `--system-prompt-file` / the
   * `CORTEX_SYSTEM_PROMPT_FILE` env. The SystemMessageLoader redirects ONLY the
   * `system_prompt` registry slot to this file; every other system message
   * (tool guides, CORTEX.md, MEMORY.md, templates, system-split caching) is
   * unchanged. This is the existing project-level override mechanism, automated:
   * equivalent to dropping the file at `.cortex/system-messages/messages/SYSTEM_PROMPT.md`.
   * Used for A/B benchmarking an alternate persona/system prompt vs the default.
   */
  systemPromptFile?: string;

  /**
   * Directories OUTSIDE the project root that the user explicitly granted tool
   * access to (the `--add-dir` / CORTEX_ADD_DIRS mechanism, like `claude --add-dir`).
   * Threaded to the executor config so file/shell tools treat a path as in-bounds
   * if it is within workingDirectory OR any of these. Absolute paths.
   */
  additionalDirectories?: string[];

  /** Enable automatic compaction */
  autoCompact?: boolean;

  /** Enable helper model fallback */
  useHelperModels?: boolean;

  /** Enable timeline tracking */
  enableTimeline?: boolean;

  /** Storage directory for sessions */
  storageDir?: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Permission profile to use ('dev', 'test', 'prod', or 'custom') */
  permissionProfile?: 'dev' | 'test' | 'prod' | 'custom';

  /** Enable MCP integration (Phase 2.9) */
  enableMcp?: boolean;

  /**
   * Restrict the model-facing BASE/factory tools to this allowlist (case- and
   * separator-insensitive). MCP, management, and context tools are NEVER
   * filtered by this — they're added on top. Used by forked sub-agents to
   * enforce their `tools` whitelist (e.g. the browse-agent gets only its
   * read tools + the injected nexus-browser MCP tools, with no WebFetch/
   * WebSearch/Browse fallback). Undefined = no restriction (all base tools).
   */
  allowedBaseTools?: string[];

  /** Working directory for tool execution (Phase 2.5) */
  workingDirectory?: string;

  /** Enable sandbox for tool execution (Phase 2.5) */
  enableSandbox?: boolean;

  /** Allowed bash commands for sandbox (Phase 2.5) */
  allowedCommands?: string[];

  /** Reactive mentorship configuration */
  reactiveMentorship?: {
    /** Enable reactive mentorship system */
    enabled: boolean;
    /** Trigger mentorship on tool errors */
    triggerOnError: boolean;
    /** Error severity threshold for triggering mentorship */
    errorSeverityThreshold: 'low' | 'medium' | 'high';
    /** Enable keyword triggers (@ultrathink, @analyze, @rethink) */
    enableKeywords: boolean;
    /** Custom keywords for mentorship triggering */
    customKeywords?: string[];
    /** Helper model ID for mentorship (defaults to 'grok-4-1-fast-non-reasoning') */
    helperModelId?: string;
    /** Enable turn-based periodic mentorship review (Phase 2) */
    turnBasedEnabled?: boolean;
    /** Number of turns between periodic mentorship reviews (Phase 2) */
    turnInterval?: number;
    /** Enable interleaved thinking assistance for non-reasoning models (Phase 2) */
    interleavedThinking?: boolean;
    /** Enable pattern detection for repeated failures (Phase 2) */
    patternDetection?: boolean;
    /** Number of similar errors to trigger pattern detection (Phase 2) */
    patternThreshold?: number;
    /** Enable Active Discovery guidance to encourage thorough file reading */
    activeDiscovery?: boolean;
  };

  /** Loop control configuration (inline detection) */
  loopControl?: {
    /** Maximum tool execution iterations per turn */
    maxToolIterations?: number;
    /** Maximum consecutive tool errors before stopping */
    maxConsecutiveErrors?: number;
    /** Soft tool-call budget per turn (R29b brake): escalating reminders at
     *  1x and 1.5x, hard force-synthesis at 2x. */
    toolBudgetSoft?: number;
    /** Tool execution timeout in milliseconds */
    toolTimeoutMs?: number;
    /** Maximum identical tool call repetitions before detecting loop */
    maxLoopRepetitions?: number;
  };

  /** Enable Anthropic Programmatic Tool Calling (PTC) — server-side code execution sandbox. */
  enablePTC?: boolean;

  /** Enable local code execution tool for non-PTC models. */
  enableLocalCodeExecution?: boolean;

  /** Enable deferred tool loading — only essential tools loaded initially. */
  enableDeferredToolLoading?: boolean;

  /** Model router configuration. */
  modelRouter?: {
    enabled: boolean;
    strategy: 'auto' | 'matrix-only';
    autoRecord: boolean;
  };

  /**
   * Sub-agent event callback for UI integration
   * Receives events from parallel sub-agent processes
   */
  onSubAgentEvent?: SubAgentEventCallback;
}

/**
 * Sub-agent event types for UI integration
 */
export type SubAgentEventType =
  | 'started'
  | 'progress'
  | 'tool_call'
  | 'text'
  | 'completed'
  | 'error';

/**
 * Sub-agent event payload
 */
export interface SubAgentEvent {
  type: SubAgentEventType;
  agentId: string;
  agentName: string;
  data: {
    model?: string;
    turnNumber?: number;
    totalTokens?: number;
    elapsedMs?: number;
    toolName?: string;
    toolSummary?: string;
    text?: string;
    isFinal?: boolean;
    status?: string;
    error?: string;
  };
}

/**
 * Callback for sub-agent events
 */
export type SubAgentEventCallback = (event: SubAgentEvent) => void;

/**
 * Send Message Options
 */
export interface SendMessageOptions {
  /** Override current model */
  modelId?: string;

  /** Available tools for this request */
  tools?: any[];

  /** Additional system messages */
  systemMessages?: string[];

  /** Model parameters */
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    [key: string]: any;
  };

  /** Enable streaming */
  streaming?: boolean;

  /** User metadata */
  metadata?: Record<string, any>;

  /** Abort signal for cancelling long-running operations (e.g., ESC key in CLI) */
  abortSignal?: AbortSignal;
}

/**
 * Orchestrator Response
 */
export interface OrchestratorResponse {
  /** UUID of response message */
  messageId: string;

  /** Response content */
  content: string | any[];

  /** Tool uses (if any) */
  toolUses?: any[];

  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cache?: {
      cacheCreationTokens: number;
      cacheReadTokens: number;
      uncachedInputTokens: number;
      cacheHitRate: number;
      costSavingsRatio: number;
    };
    /** xAI authoritative billed cost for the request (1 USD = 1e10 ticks). */
    costUsdTicks?: number;
    /** costUsdTicks / 1e10. */
    costUsd?: number;
    /** Server-side tool invocations xAI billed for this request. */
    serverSideToolsUsed?: number;
  };

  /** Model used */
  model: {
    id: string;
    provider: string;
  };

  /** Metadata */
  metadata: {
    conversationId: string;
    usedHelperModel: boolean;
    helperModelCost?: number;
    compactionTriggered: boolean;
    serverSideTools?: ServerSideToolMetadata;
    turnSummary?: string;
    nextActionPrediction?: string;
  };
}

/**
 * Stream Chunk
 */
// StreamChunk now imported from APIClient.ts

/**
 * Session
 */
export interface Session {
  sessionId: string;
  conversationId: string;
  modelId: string;
  projectPath: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
}

/**
 * Model Switch Options
 */
export interface SwitchModelOptions {
  /** Strategy for context adjustment if needed */
  strategy?: 'sliding-window' | 'preserve-critical' | 'compact-and-fit';
  /** Reason for switching (for timeline) */
  reason?: string;
}

/**
 * Model Switch Result
 */
export interface ModelSwitchResult {
  success: boolean;
  previousModel: string;
  newModel: string;
  contextAdjustment?: {
    strategy: string;
    messagesKept: number;
    messagesDropped: number;
    compactionTriggered: boolean;
  };
  timelineEventId: string;
}

/**
 * Cortex Orchestrator - Phase 2.1
 *
 * Phase 2.0: Basic message flow [OK]
 * Phase 2.1: Real API calls, gateway, model registry ⚙
 * Phase 2.2: Timeline, compaction, checkpoints
 * Phase 2.3: Historical retrieval
 */
export class CortexOrchestrator {
  // ============================================
  // STATE
  // ============================================

  private currentSessionId: string;
  private currentConversationId: string;
  private currentModelId: string;
  private messageHistory: Message[] = [];
  private turnNumber: number = 0;

  // Wave 3: Approval mode for auto-approve actions feature
  private approvalMode: { autoApproveActions: boolean };

  // Phase 2 Mentorship: Pattern Detection
  private errorPatterns: Map<string, number> = new Map();

  // Actual tool token count for accurate context budget calculations.
  // Set at the start of each turn when tools are gathered. Tool definitions are NOT
  // in messageHistory — they're sent separately to the API — so the budget must
  // reserve space for them. The old hardcoded estimate (2000) was ~4-5x too low.
  private currentToolTokens: number = 0;

  // Responses API stateful chaining: track last response ID for XAI/OpenAI
  // When set, continuation requests send previous_response_id instead of full history,
  // letting the server preserve reasoning state and improve coherence.
  // R28: byte-stable static system prompt for the current turn, split out of
  // the moving user-message slot so the provider prompt-cache prefix is stable.
  private currentStaticSystemPrompt?: string;
  // R28f: first non-empty static system prompt per conversation, replayed
  // byte-identically on later turns so xAI's cross-turn prefix cache survives
  // the turn-conditional system-message loader shrinking the system field.
  private staticSystemPromptByConversation = new Map<string, string>();
  private lastResponseId: string | null = null;

  // R20a: track which provider produced lastResponseId. XAI response IDs are
  // UUIDs (`5f573691-...`); OpenAI's are `resp_*`. Forwarding the wrong format
  // to the other provider yields a 400 "Expected an ID that begins with 'resp'."
  // Reset lastResponseId on provider switch (or use prefix-aware guard at egress).
  private lastResponseIdProvider: string | null = null;

  // messageHistory.length immediately AFTER the assistant message from the response
  // that produced `lastResponseId` was pushed. Items at indices >= this are "new since
  // the server's last checkpoint" and are the only items we should send alongside
  // previous_response_id (per XAI Responses API docs: "send the id of the previous
  // response, and the new messages to append to it").
  private messageCountAtLastResponse: number = 0;

  // Wave 3: Middleware components (will be used in Phases 3-7)
  // @ts-expect-error - Will be used in Phase 4 (retry logic)
  private errorClassifier?: ErrorClassificationMiddleware;
  // Now actively used for retry logic in API calls
  private retryMiddleware?: RetryMiddleware;
  // Wave 3: Now used for permission enforcement
  private permissionsMiddleware?: PermissionsMiddleware;
  // Now actively used for system message injection
  private systemMessageMiddleware?: SystemMessageMiddleware;
  // Now actively used for error-based mentorship triggering
  private mentorshipMiddleware?: MentorshipMiddleware;

  // PTC: Progressive tool filter for non-PTC deferred loading
  private toolFilter = new ClientSideToolFilter();

  // ============================================
  // DEPENDENCIES (Injected via Constructor)
  // ============================================
  // All dependencies now injected - see constructor

  // Session-scoped state (created per session)
  private config: OrchestratorConfig;
  private sessionTimeline?: SessionTimeline;
  private checkpointManager?: CheckpointManager;
  private fileCheckpointManager?: FileCheckpointManager; // Created in createSession() with sessionId
  private mcpAutoInject: boolean = false;

  // Phase 2.7: Cache metrics tracking
  private cacheMetricsAccumulator: CacheMetricsAccumulator = new CacheMetricsAccumulator();

  // Sub-Agent System: Manages spawning and tracking of sub-agents as child processes
  private subAgentProcessManager?: SubAgentProcessManager;

  // ============================================
  // CONSTRUCTOR
  // ============================================

  constructor(
    // Phase 1.5 Week 1: Multi-Provider
    private adapterRegistry: AdapterRegistry,
    private gatewayTranslation: GatewayTranslationLayer,
    private modelRegistry: ModularModelRegistry,
    private modelAliasResolver: ModelAliasResolver,

    // Phase 1.5 Week 2: Context & Helpers
    private helperMiddleware: HelperModelMiddleware,
    // @ts-expect-error - Kept for dependency injection pattern, used by helperMiddleware
    private compactionManager: StoredCompactionManager,
    private contextBudgetManager: ContextBudgetManager,

    // Phase 1.5 Week 3: Timeline & History
    private historyStore: JSONLHistoryStore,
    private historicalService: HistoricalContextService,

    // Phase 2.5: Tool Execution
    private executorRegistry: ExecutorRegistry,

    // Phase 2.9: MCP Integration
    private mcpConfigManager: McpConfigManager,
    private mcpRegistry: McpServerRegistry,
    private mcpManager: McpClientManager | undefined,

    // Phase 2: Core Components
    private apiClient: APIClient,
    private systemReminderInjector: SystemReminderInjector,
    // @ts-expect-error - Kept for dependency injection, now used by SystemMessageMiddleware instead
    private systemMessageLoader: SystemMessageLoader,

    // Configuration
    config: OrchestratorConfig,

    // Wave 3: Middleware components (optional for backward compatibility)
    errorClassifier?: ErrorClassificationMiddleware,
    retryMiddleware?: RetryMiddleware,
    permissionsMiddleware?: PermissionsMiddleware,
    systemMessageMiddleware?: SystemMessageMiddleware,
    mentorshipMiddleware?: MentorshipMiddleware,
  ) {
    this.config = {
      autoCompact: true,
      useHelperModels: true,
      enableTimeline: true,
      debug: false,
      storageDir: config.storageDir || '.cortex/sessions',
      ...config
    };

    // Initialize state (will be set properly when session created)
    this.currentSessionId = '';
    this.currentConversationId = '';
    this.currentModelId = config.defaultModelId;
    this.mcpAutoInject = false;

    // Wave 3: Initialize approval mode based on context
    // Interactive sessions (terminal): auto-approve OFF
    // Non-interactive (piped commands): auto-approve ON
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
    this.approvalMode = {
      autoApproveActions: !isInteractive
    };

    // Wave 3: Store middleware components
    this.errorClassifier = errorClassifier;
    this.retryMiddleware = retryMiddleware;
    this.permissionsMiddleware = permissionsMiddleware;
    this.systemMessageMiddleware = systemMessageMiddleware;
    this.mentorshipMiddleware = mentorshipMiddleware;

    // Wire SearchToolsTool provider for deferred tool discovery.
    // The closure captures `this` so it resolves the active model's naming
    // convention at call-time — names in SearchTools results match the tools
    // array the model sees (e.g. snake_case for XAI, PascalCase for Anthropic).
    if (this.config.enableDeferredToolLoading) {
      const searchExecutor = this.executorRegistry.getExecutor('SearchTools') as Record<string, any> | undefined;
      if (searchExecutor && typeof searchExecutor.setToolProvider === 'function') {
        const namingHandler = new ToolNamingHandler();
        searchExecutor.setToolProvider(() => {
          const currentModel = this.modelRegistry?.getModel(this.currentModelId);
          const convention = currentModel?.tools?.namingConvention || 'PascalCase';
          // Apply the SAME EndTurn gate as the eager tool list (see sendMessage:
          // factoryTools). Without this filter the deferred-discovery catalog
          // re-exposed EndTurn even when CORTEX_ENDTURN_GATE was off, luring the
          // model into calling a tool that the rest of the pipeline treats as
          // disabled (no Stage-2/3 grounding wired) — wasted turns.
          const endTurnGateOn = process.env.CORTEX_ENDTURN_GATE === 'true';
          // MCP-management tools (InitMcpConfig, EnableMcpServer, …) and context
          // tools (InitCortexContext) are gathered SEPARATELY in the turn flow, so
          // they are NOT in toolFactory.getAllTools(). Without adding them here the
          // model can never discover them via SearchTools — it searches "mcp_init",
          // finds nothing, and hand-writes the wrong config file. Include them so
          // deferred setup tools are actually findable.
          const extras = [...this.getMcpManagementTools(), ...this.getContextManagementTools()];
          const seen = new Set<string>();
          return [...toolFactory.getAllTools(), ...extras]
            .filter((t) => endTurnGateOn || t.name !== 'EndTurn')
            .filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
            .map((t) => ({
              name: namingHandler.convertName(t.name, convention),
              description: t.description,
              category: (t as any).category,
              schema: (t as any).schema,
            }));
        });
      }
    }

    if (this.config.debug) {
      console.log(`[Orchestrator] Dependency injection pattern - all components injected`);
      console.log(`[Orchestrator] ExecutorRegistry: ${this.executorRegistry.getExecutorCount()} executors`);
      console.log(`[Orchestrator] MCP enabled: ${mcpManager !== null}`);
      if (this.config.enableDeferredToolLoading) {
        console.log(`[Orchestrator] Deferred tool loading: ENABLED`);
      }
    }
  }

  // ============================================
  // PUBLIC API - CONVERSATION (MVP)
  // ============================================

  /**
   * Send a message and get a response
   *
   * Phase 2.1: [OK] Real API calls via GatewayTranslationLayer
   * Phase 2.2.1: [OK] Timeline tracking and history storage
   * TODO Phase 2.2.3: Helper middleware fallback
   * TODO Phase 2.2.4: Compaction integration
   */
  async sendMessage(
    content: string | any[],
    options: SendMessageOptions = {}
  ): Promise<OrchestratorResponse> {
    if (!this.sessionTimeline) {
      throw new Error('Session not initialized. Call createSession() first.');
    }

    // Responses API chain: preserve lastResponseId + checkpoint across user turns.
    // Now that input slicing is implemented (send only items added after
    // messageCountAtLastResponse when previous_response_id is set), we CAN chain
    // across user turns safely — the server gets: previous_response_id=R_last +
    // input=[new user message only]. This is exactly the pattern XAI docs show:
    //
    //     second_response = client.responses.create(
    //         previous_response_id=response.id,
    //         input=[{"role": "user", "content": "What is the meaning of 42?"}],
    //     )
    //
    // Prior regression (full history + chain id → empty output) was caused by
    // sending duplicate content. Input slicing fixes that root cause.
    //
    // We still reset if the model changes mid-session (different response-family
    // compatibility), or on explicit new-session creation. Both are handled elsewhere.

    // Phase 2 Mentorship: Check for periodic review BEFORE processing message
    if (this.shouldTriggerPeriodicReview()) {
      await this.handlePeriodicReview();
    }

    // Reactive Mentorship: Check for keyword triggers
    const mentorshipKeyword = this.detectMentorshipKeyword(content);
    if (mentorshipKeyword) {
      if (this.config.debug) {
        console.log(`[Orchestrator Mentorship] Detected keyword: ${mentorshipKeyword}`);
      }

      // Remove keyword from content
      content = this.removeKeyword(content, mentorshipKeyword);

      // Generate mentorship guidance
      try {
        const guidance = await this.helperMiddleware.generateKeywordGuidance({
          keyword: mentorshipKeyword,
          recentHistory: this.messageHistory,
          helperModelId: this.config.reactiveMentorship?.helperModelId
        });

        // Inject thinking block
        await this.injectThinkingBlock(guidance, 'keyword');

        if (this.config.debug) console.log(`[Orchestrator Mentorship] Keyword guidance injected`);
      } catch (error: any) {
        console.error(`[Orchestrator Mentorship] Failed to generate keyword guidance:`, error.message);
      }
    }

    // Phase 2 Mentorship: Provide interleaved thinking for non-reasoning models
    const userContent = typeof content === 'string' ? content : JSON.stringify(content);
    if (this.shouldUseInterleavedThinking() && !mentorshipKeyword) {
      // Only if not already triggered by keyword
      await this.handleInterleavedThinking(userContent);
    }

    // Phase 2 Mentorship: Active Discovery guidance (works for ALL models)
    if (this.config.reactiveMentorship?.activeDiscovery && this.helperMiddleware) {
      const filesRead = this.extractFilesReadFromHistory(this.messageHistory);
      try {
        const guidance = await this.helperMiddleware.generateActiveDiscoveryGuidance({
          userMessage: userContent,
          recentHistory: this.messageHistory,
          filesRead,
          helperModelId: this.config.reactiveMentorship?.helperModelId
        });

        await this.injectThinkingBlock(guidance, 'active_discovery');
      } catch {
        // Active Discovery guidance is best-effort — failures are non-critical
      }
    }

    // Track turn timing for router auto-recording
    const turnStartMs = Date.now();

    // 1. Determine model to use (with optional router)
    let modelId = options.modelId || this.currentModelId;

    if (this.config.modelRouter?.enabled && modelId === 'auto') {
      const matrix = this.getRouterMatrix();
      const classification = classifyTask(userContent);
      const recommended = matrix.recommend(classification.taskType);
      if (this.config.debug) {
        console.log(`[ModelRouter] Task classified as ${classification.taskType} (confidence: ${classification.confidence}), routing to ${recommended}`);
      }
      modelId = recommended;
    }

    const model = this.getModel(modelId);

    // Phase 1 & Phase 2: Get tools (used for both injection context and API request)
    const endTurnGateOn = (process.env.CORTEX_ENDTURN_GATE) === 'true';
    const factoryTools = this.applyBaseToolAllowlist(
      endTurnGateOn
        ? toolFactory.getAllTools()
        : toolFactory.getAllTools().filter(t => t.name !== 'EndTurn'),
    );
    const mcpTools = this.mcpAutoInject ? this.getMcpToolsAsCanonical() : [];
    const mcpManagementTools = this.getMcpManagementTools();
    const contextManagementTools = this.getContextManagementTools();

    // Include all default tools by default, or custom tools if provided
    const allTools = options.tools !== undefined
      ? [...factoryTools, ...mcpTools, ...mcpManagementTools, ...contextManagementTools, ...options.tools]
      : [...factoryTools, ...mcpTools, ...mcpManagementTools, ...contextManagementTools];
    // Phase 2.3: Inject server-side tools when enabled and model supports them
    // R20: provider-aware — XAI gets web/x/code; OpenAI gets web/code/file/image
    // (Responses API hosted tools); other providers stay client-only.
    if (isServerSideToolsEnabled() && modelSupportsServerSideTools(model)) {
      let serverTools: ReturnType<typeof toCanonicalTool>[] = [];
      if (model.provider === 'xai') {
        serverTools = [
          toCanonicalTool(XAIServerSideTools.webSearch()),
          toCanonicalTool(XAIServerSideTools.xSearch()),
          toCanonicalTool(XAIServerSideTools.codeExecution()),
        ];
      } else if (model.provider === 'openai') {
        // R20b: only auto-inject hosted tools that work without per-request user
        // config. file_search needs vector_store_ids (unknown at injection time);
        // omit from defaults — user can request it explicitly via options.tools.
        // code_interpreter gets `container: { type: 'auto' }` injected by ResponsesAPIAdapter.
        serverTools = [
          toCanonicalTool(OpenAIServerSideTools.webSearch()),
          toCanonicalTool(OpenAIServerSideTools.codeInterpreter()),
          toCanonicalTool(OpenAIServerSideTools.imageGeneration()),
        ];
      }
      if (serverTools.length > 0) {
        allTools.push(...serverTools);
        if (this.config.debug) {
          console.log(`[Orchestrator Phase 2.3] Injected ${serverTools.length} ${model.provider} server-side tools: ${serverTools.map(t => t.name).join(', ')}`);
        }
      }
    }

    const hasTools = allTools !== undefined && allTools.length > 0;

    // Compute actual tool token count for accurate context budgeting.
    // Tool definitions are NOT in messageHistory — they go separately to the API.
    // Estimate: serialize tool schemas to JSON, count chars / 4.
    this.currentToolTokens = hasTools
      ? Math.ceil(JSON.stringify(allTools).length / 4)
      : 0;

    // Phase 2: System message injection (BEFORE creating user message)
    // Delegate to SystemMessageMiddleware for injection
    let injectedContent: string | any[];
    if (this.systemMessageMiddleware) {
      const middlewareContext: MiddlewareContext = {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber,
        // Use the RESOLVED model for this request, not the session default —
        // {{modelId}} in the system prompt must reflect the model actually
        // serving the turn (e.g. a per-request model override).
        modelId: model.id,
        config: this.config
      };

      const split = await this.systemMessageMiddleware.injectWithSystemSplit(
        content,
        model,
        hasTools,
        middlewareContext
      );
      injectedContent = split.userContent;
      this.currentStaticSystemPrompt = pinStaticSystemPrompt(
        this.staticSystemPromptByConversation,
        this.currentConversationId,
        split.systemPrompt
      );

      if (this.config.debug) {
        console.log('[Orchestrator] System messages injected via middleware (system split for cache stability)');
      }
    } else {
      // Fallback: no injection if middleware not available
      injectedContent = content;
      this.currentStaticSystemPrompt = undefined;
    }

    // R42: MCP tool announcement — give the model a readable summary of connected
    // MCP servers and their tools, so it understands the landscape beyond the raw
    // tools array. Only inject on the first turn (turnNumber === 0) to avoid
    // repeating the announcement every turn.
    if (mcpTools.length > 0 && this.turnNumber === 0) {
      const serverGroups = new Map<string, string[]>();
      for (const t of mcpTools) {
        const server = (t as any).serverName || 'unknown';
        if (!serverGroups.has(server)) serverGroups.set(server, []);
        serverGroups.get(server)!.push(t.name);
      }
      const lines: string[] = ['# MCP Server Instructions\n\nThe following MCP servers are connected and their tools are available:'];
      for (const [server, tools] of serverGroups) {
        lines.push(`\n## ${server}\n${tools.length} tools: ${tools.join(', ')}`);
      }
      const mcpAnnouncement = `<harness-note source="automated-harness" from-user="false">\n${lines.join('\n')}\n</harness-note>`;
      if (Array.isArray(injectedContent)) {
        (injectedContent as any[]).unshift({ type: 'text', text: mcpAnnouncement });
      }
    }

    // R42: Slash command announcement — list available commands so the model can
    // suggest them to users when relevant. First turn only.
    if (this.turnNumber === 0) {
      const commands = slashCommandRegistry.getAllCommands();
      if (commands.length > 0) {
        const categoryGroups = new Map<string, string[]>();
        for (const cmd of commands) {
          if (!categoryGroups.has(cmd.category)) categoryGroups.set(cmd.category, []);
          const alias = cmd.altName ? ` (/${cmd.altName})` : '';
          categoryGroups.get(cmd.category)!.push(`/${cmd.name}${alias} — ${cmd.description}`);
        }
        const cmdLines: string[] = ['# Available Slash Commands\n'];
        for (const [category, cmds] of categoryGroups) {
          cmdLines.push(`## ${category}\n${cmds.join('\n')}`);
        }
        const cmdAnnouncement = `<harness-note source="automated-harness" from-user="false">\n${cmdLines.join('\n')}\n</harness-note>`;
        if (Array.isArray(injectedContent)) {
          (injectedContent as any[]).unshift({ type: 'text', text: cmdAnnouncement });
        }
      }
    }

    // Deferred tool loading: categorized announcement with descriptions so
    // the model can match user intent to tool names without needing full schemas.
    if (this.config.enableDeferredToolLoading && Array.isArray(injectedContent)) {
      const convention = model.tools?.namingConvention || 'PascalCase';
      const announcement = this.buildDeferredToolAnnouncement(convention);
      if (announcement) {
        (injectedContent as any[]).unshift({ type: 'text', text: announcement });
      }
    }

    // Repository state (git + cross-agent staleness) — every turn.
    this.injectRepoStateNote(injectedContent);
    this.injectAutoResearchCapability(injectedContent);

    // 2. Create user message for history (use ORIGINAL content, not injected)
    // System-reminder tags are ephemeral and should NOT be saved to persistent storage
    const userMessageId = uuidv4();
    const userMessage: Message = {
      uuid: userMessageId,
      timestamp: new Date().toISOString(),
      type: 'user',
      message: {
        role: 'user',
        content: content // Use ORIGINAL content WITHOUT system-reminder injection
      },
      timeline: {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber
      },
      model: {
        id: model.id,
        provider: model.provider,
        apiPattern: model.api.pattern
      }
    };

    // 3. Record in timeline
    this.sessionTimeline.recordMessage(userMessageId, 'user');

    // 4. Add to history (ORIGINAL content)
    this.messageHistory.push(userMessage);

    // 5. Save to persistent storage (ORIGINAL content without system-reminder tags)
    await this.historyStore.appendMessage(this.currentSessionId, userMessage);

    // 5a. Auto-generate session title on first turn (fire-and-forget)
    if (this.turnNumber === 0 && this.helperMiddleware) {
      this.generateAndSaveSessionTitle(userContent).catch(() => {});
    }

    // 6. Proactive context management - ensure history fits before sending
    await this.ensureHistoryFitsModel(model);

    // 7. Convert history to canonical messages for API
    // For the API call, we need to use the injected content (with system-reminder tags)
    // But we already saved the original content to persistent storage
    // So we create a temporary message with injected content for the API only
    const messageHistoryForApi = [...this.messageHistory];
    // Replace the last message (user message we just added) with injected version
    const userMessageForApi: Message = {
      ...userMessage,
      message: {
        role: 'user',
        content: injectedContent // Use injected content for API
      }
    };
    messageHistoryForApi[messageHistoryForApi.length - 1] = userMessageForApi;

    // canonicalHistory will be re-computed after effectiveModel is determined
    // (see input-slicing for cross-turn chain below).
    // Debug logging for tools (already gathered above)
    if (this.config.debug && hasTools) {
      const mcpCount = mcpTools.length;
      const mgmtCount = mcpManagementTools.length;
      const totalCount = allTools!.length;

      console.log(`[Orchestrator Phase 2] Tool context: ${totalCount} tools total`);
      if (mcpCount > 0) {
        if (process.env.DEBUG === 'true') console.log(`[Orchestrator Phase 2.5] Including ${mcpCount} MCP tools (from MCP_CONFIG.md)`);
      }
      if (mgmtCount > 0) {
        console.log(`[Orchestrator Phase 2.6] Including ${mgmtCount} MCP management tools`);
      }
    }

    // Phase 2.4: Server-Side Tool Detection
    // Determine if we should use server-side tools and which endpoint to use
    let serverSideDetection: ServerSideToolDetectionResult | null = null;
    let effectiveModel = model; // Model config to use (may be modified for endpoint switching)

    if (allTools && allTools.length > 0) {
      serverSideDetection = shouldUseServerSideTools(model, allTools);

      if (serverSideDetection.useServerSideTools) {
        // Create modified model config with Responses API endpoint AND adapter
        effectiveModel = {
          ...model,
          api: {
            ...model.api,
            pattern: serverSideDetection.apiPattern,
            endpoint: serverSideDetection.endpoint
          },
          tools: {
            ...model.tools,
            adapter: 'ResponsesAPIAdapter' // Switch to Responses API adapter for server-side tools
          }
        };

        if (this.config.debug) {
          console.log('[Orchestrator] Server-side tools detected:', {
            reason: serverSideDetection.reason,
            endpoint: serverSideDetection.endpoint,
            toolCount: serverSideDetection.tools.length
          });
        }
      }
    }

    // Now that effectiveModel is determined, build canonicalHistory.
    // Input-slicing for cross-turn Responses API chain: when lastResponseId carries
    // over from a prior user turn AND effectiveModel uses Responses API, send only
    // items added since the last checkpoint.
    const initialCanSliceInput =
      this.lastResponseId !== null &&
      effectiveModel.api.pattern === 'responses' &&
      this.messageCountAtLastResponse > 0 &&
      this.messageCountAtLastResponse < messageHistoryForApi.length;
    const initialHistoryForApi = initialCanSliceInput
      ? messageHistoryForApi.slice(this.messageCountAtLastResponse)
      : messageHistoryForApi;
    const canonicalHistory = this.convertToCanonicalMessages(initialHistoryForApi);

    if (initialCanSliceInput && this.config.debug) {
      console.log(`[Orchestrator] Input-sliced initial request for cross-turn chain: sent ${initialHistoryForApi.length}/${messageHistoryForApi.length} messages`);
    }

    // 7. Prepare request via GatewayTranslationLayer
    // Use filtered tools from detection (server-side only or client-side only)
    let toolsToUse = serverSideDetection ? serverSideDetection.tools : allTools;

    // Check if PTC should be used for this request
    const isPTCEnabled = this.config.enablePTC && effectiveModel.supportsPTC && effectiveModel.provider === 'anthropic';

    // Deferred loading: filter tools for non-PTC paths (essential + recently-used only)
    if (!isPTCEnabled && this.config.enableDeferredToolLoading && toolsToUse && toolsToUse.length > 0) {
      toolsToUse = this.toolFilter.getFilteredTools(toolsToUse);
    }

    // Reset sequential call counter at start of each user turn
    this.mentorshipMiddleware?.resetSequentialCalls(this.currentSessionId);

    const preparedRequest = this.gatewayTranslation.prepareRequest(
      canonicalHistory,
      toolsToUse,
      effectiveModel,
      {
        temperature: options.parameters?.temperature,
        maxTokens: options.parameters?.maxTokens,
        topP: options.parameters?.topP,
        reasoningEffort: options.parameters?.reasoningEffort, // GPT-5.1 reasoning level
        stream: options.streaming,
        staticSystemPrompt: this.currentStaticSystemPrompt, // R28
        conversationId: this.currentConversationId // R28b
      }
    );

    // Stateful Responses API: chain from prior response when available
    // (works across user turns — lastResponseId is preserved between messages).
    // Only affects 'responses' api.pattern; other providers ignore this field.
    // R20a: only forward when the prior response was produced by the SAME
    // provider — XAI UUIDs and OpenAI resp_* ids are mutually incompatible.
    if (
      this.lastResponseId &&
      effectiveModel.api.pattern === 'responses' &&
      this.lastResponseIdProvider === effectiveModel.provider
    ) {
      preparedRequest.previousResponseId = this.lastResponseId;
    }

    // Cache-routing: session id as conversation id (XAI uses for sticky-routing).
    // Applied to all providers — ignored by those that don't use it.
    preparedRequest.conversationId = this.currentSessionId;

    // PTC: Override tools with defer_loading + PTC system tools
    if (isPTCEnabled && toolsToUse && toolsToUse.length > 0) {
      preparedRequest.tools = this.gatewayTranslation.prepareToolsWithPTC(toolsToUse, effectiveModel);
      (preparedRequest.parameters as any).enablePTC = true;
    }

    if (this.config.debug) {
      console.log('[Orchestrator] Sending to provider:', effectiveModel.provider);
      console.log('[Orchestrator] Model:', effectiveModel.id);
      console.log('[Orchestrator] API Pattern:', effectiveModel.api.pattern);
      console.log('[Orchestrator] Endpoint:', effectiveModel.api.endpoint);
      console.log('[Orchestrator] Messages:', preparedRequest.messages.length);
      if (process.env.DEBUG === 'true') console.log('[Orchestrator] Tools:', toolsToUse ? toolsToUse.length : 0);
      console.log('[Orchestrator] Has previousResponseId:', !!preparedRequest.previousResponseId);
    }

    // 8. Send request to provider via API client (with error handling and retry logic)
    let apiResponse;
    let usedHelperModel = false;
    let helperModelMetadata: any = undefined;

    try {
      // Use effectiveModel (which may have modified endpoint/pattern for server-side tools)
      // Wrap API call with retry middleware for automatic retry on transient errors
      if (this.retryMiddleware) {
        const retryResult = await this.retryMiddleware.executeWithRetry(
          () => this.apiClient.sendRequest(preparedRequest, effectiveModel),
          'primary_api_call'
        );

        apiResponse = retryResult.result;

        // Log retry information if retries occurred
        if (this.config.debug && retryResult.attemptCount > 1) {
          console.log(`[Orchestrator] API call succeeded after ${retryResult.attemptCount} attempts`);
          console.log(`[Orchestrator] Total retry time: ${retryResult.totalDelayMs}ms`);
        }
      } else {
        // Fallback: direct call if middleware not available
        apiResponse = await this.apiClient.sendRequest(preparedRequest, effectiveModel);
      }
    } catch (error: any) {
      // Phase 2.2.3: Context rejection handling with helper middleware
      if (ErrorDetector.isContextLimitError(error, model.provider)) {
        if (this.config.useHelperModels) {
          if (this.config.debug) console.log(`[Orchestrator] Context limit exceeded for ${model.id}, activating helper middleware...`);

          // Construct context limit error for middleware
          const contextError = {
            type: 'context_limit' as const,
            provider: model.provider,
            modelId: model.id,
            message: error.message,
            name: error.name || 'ContextLimitError',
            stack: error.stack
          };

          // Prepare request for helper middleware (convert back to generic format)
          const helperRequest = {
            messages: preparedRequest.messages,
            tools: preparedRequest.tools,
            parameters: preparedRequest.parameters
          };

          try {
            // Call helper middleware to compact and retry
            const helperResponse = await this.helperMiddleware.handleContextRejection(
              helperRequest,
              contextError,
              model
            );

            // Mark that we used helper model
            usedHelperModel = true;
            helperModelMetadata = {
              helperModelUsed: true,
              compactionTriggered: true,
              helperModelCost: helperResponse.metadata?.cost || 0,
              tokensSaved: helperResponse.metadata?.tokensSaved || 0,
              helperModelId: helperResponse.metadata?.helperModelId
            };

            // Phase 2.2.4: Record compaction event in timeline
            if (this.sessionTimeline && helperResponse.metadata?.compactionId) {
              const startTurn = Math.max(0, this.turnNumber - 10); // Estimate compaction range
              const endTurn = this.turnNumber;
              const messageCount = helperResponse.metadata.messageCount || this.messageHistory.length;

              this.sessionTimeline.recordCompaction(
                helperResponse.metadata.compactionId,
                startTurn,
                endTurn,
                messageCount,
                helperResponse.metadata.originalTokens || 0,
                helperResponse.metadata.compressedTokens || 0,
                'helper-fallback',
                helperResponse.metadata.helperModelId
              );
            }

            // Convert helper response to API response format
            apiResponse = {
              data: helperResponse,
              status: 200,
              headers: {},
              model: model.id
            };

            if (this.config.debug) console.log(`[Orchestrator] Helper middleware succeeded, response ready`);
          } catch (helperError: any) {
            console.error(`[Orchestrator] Helper middleware failed:`, helperError);
            throw new Error(
              `Context limit exceeded for ${model.id} and helper model fallback failed. ` +
              `Original error: ${error.message}. ` +
              `Helper error: ${helperError.message}`
            );
          }
        } else {
          throw new Error(
            `Context limit exceeded for ${model.id}. ` +
            `Helper models are disabled. Enable with useHelperModels: true. ` +
            `Original error: ${error.message}`
          );
        }
      } else {
        // Not a context limit error, rethrow
        throw error;
      }
    }

    // 9. Convert response back to canonical format
    const convertedResponse = this.gatewayTranslation.convertResponse(
      apiResponse.data,
      effectiveModel,  // Use effectiveModel (may have switched to Responses API)
      {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber + 1
      }
    );

    // Track Responses API response ID for stateful chaining (XAI, OpenAI)
    // R20a: also track which provider produced it — prevents cross-provider
    // leak (XAI UUIDs vs OpenAI resp_* are mutually incompatible).
    if (effectiveModel.api.pattern === 'responses' && apiResponse.data?.id) {
      this.lastResponseId = apiResponse.data.id;
      this.lastResponseIdProvider = effectiveModel.provider;
      if (this.config.debug) {
        console.log(`[Orchestrator] Responses API response ID tracked: ${this.lastResponseId} (provider=${effectiveModel.provider})`);
      }
    }

    // Phase 2.7: Track cache metrics (persist AFTER history push below so
    // messageCountAtLastResponse is current when we save responsesApiChain).
    if (convertedResponse.usage) {
      this.cacheMetricsAccumulator.addUsage(convertedResponse.usage, effectiveModel.provider);

      if (this.config.debug && convertedResponse.usage.cache) {
        console.log('[Orchestrator Cache] Cache hit detected:', {
          provider: effectiveModel.provider,
          cacheReadTokens: convertedResponse.usage.cache.cacheReadTokens,
          hitRate: (convertedResponse.usage.cache.cacheHitRate * 100).toFixed(1) + '%',
          costSavings: (convertedResponse.usage.cache.costSavingsRatio * 100).toFixed(1) + '%'
        });
      }
    }

    // 10. Extract assistant response (ensure it exists)
    if (!convertedResponse.messages || convertedResponse.messages.length === 0) {
      throw new Error('No response message returned from provider');
    }
    const assistantCanonicalMessage = convertedResponse.messages[0]!; // Non-null assertion after check
    const assistantMessageId = assistantCanonicalMessage.uuid; // Use UUID from canonical message

    // 11. Convert to Message type for history
    const assistantMessage: Message = {
      uuid: assistantMessageId,
      timestamp: assistantCanonicalMessage.timestamp,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: assistantCanonicalMessage.content as any // Content blocks array
      },
      timeline: {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber + 1
      },
      model: {
        id: effectiveModel.id,
        provider: effectiveModel.provider,
        apiPattern: effectiveModel.api.pattern
      },
      ...(convertedResponse.usage && { usage: convertedResponse.usage })
    };

    // 12. Record in timeline
    this.sessionTimeline.recordMessage(assistantMessageId, 'assistant');

    // 13. Add to history
    this.messageHistory.push(assistantMessage);

    // Input-slicing checkpoint: this index is the last message the server has "seen"
    // (it's in the response we just got). Anything pushed after this is "new" and
    // should be the only content sent alongside previous_response_id on the next call.
    this.messageCountAtLastResponse = this.messageHistory.length;

    // 14. Save to persistent storage
    await this.historyStore.appendMessage(this.currentSessionId, assistantMessage);

    // Persist cache metrics + chain state — AFTER checkpoint update so the stored
    // messageCountAtLastResponse reflects the post-push state.
    if (convertedResponse.usage) {
      this.persistCacheMetrics(effectiveModel.id).catch(err => {
        if (this.config.debug) {
          console.warn('[Orchestrator] Failed to persist cache metrics:', err);
        }
      });
    }

    // ============================================
    // Phase 2.5 Day 2: Multi-turn tool calling loop
    // Phase 2.5 Day 3: Enhanced with error handling, timeouts, and recovery
    // ============================================
    /**
     * Inline loop detection.
     *
     * Catches:
     *   - 5+ identical tool calls (same name + JSON-stringified input hash)
     *     via the `recentToolCalls` array
     *   - Hard cap at MAX_TOOL_ITERATIONS (default 50, via SettingsSchema)
     *   - Consecutive errors via MAX_CONSECUTIVE_ERRORS (default 3)
     *   - Per-tool timeout via TOOL_TIMEOUT_MS (default 120s)
     */
    // Keep executing tools until model returns a text response
    let currentAssistantMessage = assistantMessage;
    let currentAssistantCanonicalMessage = assistantCanonicalMessage;
    let toolCallIteration = 0;

    // Loop control settings — single source of truth via getLoopControlConfig()
    const loopDefaults = this.getLoopControlConfig();
    const MAX_TOOL_ITERATIONS = loopDefaults.maxToolIterations;
    const TOOL_TIMEOUT_MS = loopDefaults.toolTimeoutMs;
    const MAX_CONSECUTIVE_ERRORS = loopDefaults.maxConsecutiveErrors;
    const MAX_LOOP_REPETITIONS = loopDefaults.maxLoopRepetitions;
    const TOOL_BUDGET_SOFT = loopDefaults.toolBudgetSoft; // R29b brake
    const TOOL_BUDGET_HARD = TOOL_BUDGET_SOFT * 2; // force-synthesis cap

    let totalToolErrors = 0;

    // Round 18b: track whether we've already retried on empty response so
    // we don't loop forever. See empty-detection block below.
    let emptyResponseRetryUsed = false;

    // EndTurn gate (Stage 1): the turn must not complete until the model
    // calls the EndTurn attestation tool. Steering is ignored by some
    // models (grok-4.3); a required tool call is not. Bounded so a model
    // that refuses cannot hang the turn (fallback: accept after N nudges).
    let endTurnCalled = false;
    let endTurnNudges = 0;
    const END_TURN_MAX_NUDGES = 2;
    // EndTurn gate / Stages 1-3 are OPT-IN (default OFF). The line-number
    // fabrication they targeted is fully resolved at the root cause:
    // ReadFileTool now emits real `cat -n` line numbers, so the model
    // transcribes instead of confabulating (two-condition benchmark: gate
    // OFF + numbered Read = 0 fabrication, exact correct lines). The gate
    // remains available as a mandatory pre-delivery self-audit + the
    // cortex-channel training-substrate emitter — set CORTEX_ENDTURN_GATE=true.
    const endTurnGateEnabled = (process.env.CORTEX_ENDTURN_GATE) === 'true';
    // Stage 3: the last EndTurn call's citations, so the drafted final
    // answer's line-number claims can be verified against what was actually
    // read this turn (verifyCoordinates). Stage-2-grounded citations are the
    // trusted baseline a coordinate must map to.
    let lastEndTurnCitations: Array<{ reference: string; verbatim_source: string }> | undefined;
    let endTurnLastToolName: string | undefined; // for the cortex training record
    // Scope: the gate ONLY arms when the turn actually used a (non-EndTurn)
    // tool. A pure-language turn has no tool-derived artifact to
    // misattribute, so forcing EndTurn there is pure overhead → bypass.
    let turnUsedTools = false;
    // Drives the adaptive reminder (verification emphasis vs citation
    // emphasis) keyed to what the turn actually did.
    let turnUsedMutatingTool = false; // Edit/Write/Bash/NotebookEdit
    let turnUsedReadishTool = false; // Read/Grep/Glob
    // Stage 2: concatenated text of every (non-EndTurn) tool result the
    // model saw THIS turn — the haystack EndTurn citations are verified
    // against. A cited verbatim_source not found here is a regurgitated
    // prior, not an observation: the EndTurn call is rejected.
    const thisTurnToolOutputs: string[] = [];

    // Loop detection: Track recent tool calls to detect repetitive loops
    const recentToolCalls: Array<{ name: string; inputHash: string }> = [];

    // Track all tool uses across iterations for response
    const allExecutedToolUses: Array<{ id: string; name: string; input: any }> = [];

    // Track tool call counts for diversity warning
    const toolCallCounts = new Map<string, number>();

    while (toolCallIteration < MAX_TOOL_ITERATIONS) {
      try {
        // DEBUG: Log canonical message content structure for tool extraction
        if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
          const toolBlocks = currentAssistantCanonicalMessage.content.filter((b: any) => b.type === 'tool_use');
          if (toolBlocks.length > 0) {
            console.log(`[DEBUG Orchestrator] Tool blocks in canonical message:`,
              toolBlocks.map((b: any) => ({
                type: b.type,
                hasToolUse: !!b.toolUse,
                toolUseKeys: b.toolUse ? Object.keys(b.toolUse) : [],
                input: b.toolUse?.input,
                inputKeys: b.toolUse?.input ? Object.keys(b.toolUse.input) : []
              }))
            );
          }
        }

        // Extract tool_use blocks from current assistant response
        // Debug: Log all content blocks to trace what model is outputting
        const allContentTypes = currentAssistantCanonicalMessage.content.map((b: any) => b.type);
        if (this.config.debug) console.log(`[Orchestrator] Response content blocks: ${allContentTypes.join(', ')}`);

        const toolUseBlocks = currentAssistantCanonicalMessage.content
          .filter((block: any) => block.type === 'tool_use')
          .map((block: any) => ({
            id: block.toolUse.id,
            name: block.toolUse.name,
            input: block.toolUse.input
          }));

        if (this.config.debug && toolUseBlocks.length > 0) {
          console.log(`[Orchestrator] Extracted tools: ${toolUseBlocks.map((t: any) => t.name).join(', ')}`);
        }

        // If no tool calls, we're done — UNLESS the response is empty.
        if (toolUseBlocks.length === 0) {
          // Round 18b (multi-model bench finding): detect empty responses
          // (thinking-only or completely empty content). Observed with
          // claude-sonnet-4-6 + extended thinking and other models that
          // emit thinking blocks then stop without producing the final
          // answer. Retry ONCE with an explicit completion prompt.
          const hasVisibleText = hasVisibleAssistantText(currentAssistantCanonicalMessage.content);
          if (!hasVisibleText && !emptyResponseRetryUsed) {
            emptyResponseRetryUsed = true;
            console.warn(
              `[Orchestrator] Empty response detected (no tool_use, no text, iteration=${toolCallIteration}). ` +
              `Retrying once with explicit completion prompt.`,
            );

            // R26 (2026-05-15, surfaced by A/B benchmark): the empty assistant
            // turn is already in messageHistory. The retry below rebuilds the
            // full history and re-sends it. Anthropic's Messages API tolerates
            // a zero-content message; XAI's Messages API hard-400s with
            // "Each message must have at least one content element", crashing
            // the entire retry. R18b was validated on Claude, so this was
            // invisible until a grok run emitted an empty turn. Repair the
            // empty assistant message in-place with a minimal placeholder so
            // every provider's message-content contract is satisfied.
            for (let i = this.messageHistory.length - 1; i >= 0; i--) {
              const m: any = this.messageHistory[i];
              const isAssistant = m?.type === 'assistant' || m?.message?.role === 'assistant';
              if (!isAssistant) continue;
              const content = m?.message?.content;
              const isEmpty = !content
                || (Array.isArray(content) && content.length === 0)
                || (typeof content === 'string' && content.trim() === '');
              if (isEmpty) {
                m.message = m.message || { role: 'assistant' };
                m.message.content = [{ type: 'text', text: '(no output)' }];
                if (this.config.debug) {
                  console.log(`[Orchestrator] R26: repaired empty assistant message at history[${i}] before retry`);
                }
              }
              break; // only the most recent assistant turn is the culprit
            }

            // Push a synthetic user follow-up. The assistant's empty/thinking
            // message is already in history (line ~1033/1041), so the model
            // has the full prior context.
            const followupUserMessage: Message = {
              uuid: uuidv4(),
              timestamp: new Date().toISOString(),
              type: 'user',
              message: {
                role: 'user',
                content: [{
                  type: 'text',
                  text: '<system-reminder>Your previous response had no visible text. Please provide your final answer in plain text now — summarize your findings or complete the requested task. Do not call any more tools.</system-reminder>',
                }],
              },
              timeline: {
                sessionId: this.currentSessionId,
                conversationId: this.currentConversationId,
                turnNumber: this.turnNumber + 1,
              },
              model: {
                id: effectiveModel.id,
                provider: effectiveModel.provider,
                apiPattern: effectiveModel.api.pattern,
              },
            } as any;

            this.messageHistory.push(followupUserMessage);
            await this.historyStore.appendMessage(this.currentSessionId, followupUserMessage);

            // Build a continuation request and re-call. Mirrors the
            // tool-result continuation path (lines ~1395-1466) but without
            // tool_result blocks.
            await this.ensureHistoryFitsModel(effectiveModel);
            const retryCanonicalHistory = this.convertToCanonicalMessages([...this.messageHistory]);
            const retryRequest = this.gatewayTranslation.prepareRequest(
              retryCanonicalHistory,
              toolsToUse,
              effectiveModel,
              {
                temperature: options.parameters?.temperature,
                maxTokens: options.parameters?.maxTokens,
                topP: options.parameters?.topP,
                reasoningEffort: options.parameters?.reasoningEffort,
                stream: options.streaming,
                staticSystemPrompt: this.currentStaticSystemPrompt, // R28
                conversationId: this.currentConversationId, // R28b
              },
            );
            if (this.lastResponseId && effectiveModel.api.pattern === 'responses') {
              retryRequest.previousResponseId = this.lastResponseId;
            }
            retryRequest.conversationId = this.currentSessionId;

            let retryApiResponse;
            if (this.retryMiddleware) {
              const retryResult = await this.retryMiddleware.executeWithRetry(
                () => this.apiClient.sendRequest(retryRequest, effectiveModel),
                'empty_response_retry',
              );
              retryApiResponse = retryResult.result;
            } else {
              retryApiResponse = await this.apiClient.sendRequest(retryRequest, effectiveModel);
            }

            const retryConverted = this.gatewayTranslation.convertResponse(
              retryApiResponse.data,
              effectiveModel,
              {
                sessionId: this.currentSessionId,
                conversationId: this.currentConversationId,
                turnNumber: this.turnNumber + 1,
              },
            );

            if (effectiveModel.api.pattern === 'responses' && retryApiResponse.data?.id) {
              this.lastResponseId = retryApiResponse.data.id;
              this.lastResponseIdProvider = effectiveModel.provider; // R20a
            }

            if (retryConverted.messages && retryConverted.messages.length > 0) {
              const retryAssistantCanonical = retryConverted.messages[0]!;
              const retryAssistantMessage: Message = {
                uuid: retryAssistantCanonical.uuid,
                timestamp: retryAssistantCanonical.timestamp,
                type: 'assistant',
                message: {
                  role: 'assistant',
                  content: retryAssistantCanonical.content as any,
                },
                timeline: {
                  sessionId: this.currentSessionId,
                  conversationId: this.currentConversationId,
                  turnNumber: this.turnNumber + 1,
                },
                model: {
                  id: effectiveModel.id,
                  provider: effectiveModel.provider,
                  apiPattern: effectiveModel.api.pattern,
                },
                ...(retryConverted.usage && { usage: retryConverted.usage }),
              } as any;
              this.messageHistory.push(retryAssistantMessage);
              await this.historyStore.appendMessage(this.currentSessionId, retryAssistantMessage);

              // Update current pointer so the loop re-evaluates with new content.
              currentAssistantMessage = retryAssistantMessage as any;
              currentAssistantCanonicalMessage = retryAssistantCanonical;
              continue;
            }
          }

          // EndTurn gate (Stage 1): refuse to finalize until the model has
          // called the EndTurn attestation tool. Only arms when the turn
          // actually used a (non-EndTurn) tool — pure-language turns bypass.
          // Mirrors the R18b empty-response continuation. Bounded by
          // END_TURN_MAX_NUDGES so a model that will not comply still
          // terminates (fallback: accept).
          // Stage 3: when EndTurn passed Stage-2 grounding, also verify the
          // DRAFTED final answer's line-number claims map to a citation whose
          // verbatim_source actually sits at that line in this turn's reads.
          // Q1 proved the fabrication is intrinsic regurgitation — only a
          // deterministic reject closes it.
          let stage3Violations: Array<{ claim: string; line: number }> = [];
          if (endTurnGateEnabled && turnUsedTools && endTurnCalled) {
            const draft = Array.isArray(currentAssistantCanonicalMessage.content)
              ? (currentAssistantCanonicalMessage.content as any[])
                  .filter((b: any) => b?.type === 'text')
                  .map((b: any) => b.text || '')
                  .join('\n')
              : String(currentAssistantCanonicalMessage.content ?? '');
            const cv = verifyCoordinates(draft, thisTurnToolOutputs.join('\n'), lastEndTurnCitations);
            if (!cv.ok) stage3Violations = cv.violations;
          }

          if (
            endTurnGateEnabled && turnUsedTools && endTurnNudges < END_TURN_MAX_NUDGES &&
            (!endTurnCalled || stage3Violations.length > 0)
          ) {
            endTurnNudges++;
            const gateReason = !endTurnCalled ? 'missing-EndTurn' : 'coordinate-violation';
            console.warn(
              `[Orchestrator] EndTurn gate: ${gateReason} ` +
              `(nudge ${endTurnNudges}/${END_TURN_MAX_NUDGES}, iteration=${toolCallIteration}` +
              `${stage3Violations.length ? `, ungrounded lines: ${stage3Violations.map((v) => v.line).join(',')}` : ''}).`,
            );

            for (let i = this.messageHistory.length - 1; i >= 0; i--) {
              const m: any = this.messageHistory[i];
              const isAssistant = m?.type === 'assistant' || m?.message?.role === 'assistant';
              if (!isAssistant) continue;
              const content = m?.message?.content;
              const isEmpty = !content
                || (Array.isArray(content) && content.length === 0)
                || (typeof content === 'string' && content.trim() === '');
              if (isEmpty) {
                m.message = m.message || { role: 'assistant' };
                m.message.content = [{ type: 'text', text: '(no output)' }];
              }
              break;
            }

            // Adaptive reminder: name what THIS turn actually did (specific
            // imperatives bind harder than generic boilerplate).
            const citEmphasis = turnUsedReadishTool
              ? ' You read code/files this turn: for EACH reference in your draft give the EXACT verbatim source you copied it from; if you cannot, DELETE that reference and quote the code instead of asserting a coordinate.'
              : '';
            const verEmphasis = turnUsedMutatingTool
              ? ' You ran edit/write/bash this turn: in `verification` list every build/test/lint command you ACTUALLY ran with the real result line you saw — do not claim a check you did not run.'
              : '';
            const endTurnReminderText = !endTurnCalled
              ? ('<system-reminder>You used tools this turn but have not called end_turn. ' +
                 'You MUST call end_turn before any final answer. It is generative, not a checkbox: ' +
                 'reconstruct `citations` (array of {reference, verbatim_source}), `verification` ' +
                 '(array of {command, observed_result}), `summary`, `open_items`, and a skeptical ' +
                 '`self_review` (what you did NOT check, what is assumed/possibly wrong, what one ' +
                 'more tool call would verify).' +
                 citEmphasis +
                 verEmphasis +
                 ' Call end_turn now — do not produce a final answer until you have.</system-reminder>')
              : ('<system-reminder>end_turn REJECTED. Your drafted answer asserts line number(s) ' +
                 stage3Violations.map((v) => v.line).join(', ') +
                 ' that are NOT backed by any citation whose verbatim_source actually sits at that ' +
                 "line in what you read this turn — a regurgitated coordinate, not an observation, " +
                 'exactly like a non-matching edit old_string. ACCEPTANCE CRITERIA to pass: ' +
                 '(1) for every line number you keep, add or repair a citation whose verbatim_source ' +
                 "is the EXACT code copied from that line of this turn's read output; " +
                 '(2) for any you cannot ground, DELETE the number and quote the verbatim code ' +
                 'instead — a quote with no number is correct; a wrong number is a failed answer. ' +
                 'Then call end_turn again with corrected citations and produce the answer.</system-reminder>');

            const endTurnReminder: Message = {
              uuid: uuidv4(),
              timestamp: new Date().toISOString(),
              type: 'user',
              message: {
                role: 'user',
                content: [{
                  type: 'text',
                  text: endTurnReminderText,
                }],
              },
              timeline: {
                sessionId: this.currentSessionId,
                conversationId: this.currentConversationId,
                turnNumber: this.turnNumber + 1,
              },
              model: {
                id: effectiveModel.id,
                provider: effectiveModel.provider,
                apiPattern: effectiveModel.api.pattern,
              },
            } as any;
            this.messageHistory.push(endTurnReminder);
            await this.historyStore.appendMessage(this.currentSessionId, endTurnReminder);

            await this.ensureHistoryFitsModel(effectiveModel);
            const gateCanonicalHistory = this.convertToCanonicalMessages([...this.messageHistory]);
            const gateRequest = this.gatewayTranslation.prepareRequest(
              gateCanonicalHistory,
              toolsToUse,
              effectiveModel,
              {
                temperature: options.parameters?.temperature,
                maxTokens: options.parameters?.maxTokens,
                topP: options.parameters?.topP,
                reasoningEffort: options.parameters?.reasoningEffort,
                stream: options.streaming,
                staticSystemPrompt: this.currentStaticSystemPrompt,
                conversationId: this.currentConversationId,
              },
            );
            if (this.lastResponseId && effectiveModel.api.pattern === 'responses') {
              gateRequest.previousResponseId = this.lastResponseId;
            }
            gateRequest.conversationId = this.currentSessionId;

            let gateApiResponse;
            if (this.retryMiddleware) {
              const gateResult = await this.retryMiddleware.executeWithRetry(
                () => this.apiClient.sendRequest(gateRequest, effectiveModel),
                'end_turn_gate',
              );
              gateApiResponse = gateResult.result;
            } else {
              gateApiResponse = await this.apiClient.sendRequest(gateRequest, effectiveModel);
            }

            const gateConverted = this.gatewayTranslation.convertResponse(
              gateApiResponse.data,
              effectiveModel,
              {
                sessionId: this.currentSessionId,
                conversationId: this.currentConversationId,
                turnNumber: this.turnNumber + 1,
              },
            );

            if (effectiveModel.api.pattern === 'responses' && gateApiResponse.data?.id) {
              this.lastResponseId = gateApiResponse.data.id;
              this.lastResponseIdProvider = effectiveModel.provider;
            }

            if (gateConverted.messages && gateConverted.messages.length > 0) {
              const gateAssistantCanonical = gateConverted.messages[0]!;
              const gateAssistantMessage: Message = {
                uuid: gateAssistantCanonical.uuid,
                timestamp: gateAssistantCanonical.timestamp,
                type: 'assistant',
                message: {
                  role: 'assistant',
                  content: gateAssistantCanonical.content as any,
                },
                timeline: {
                  sessionId: this.currentSessionId,
                  conversationId: this.currentConversationId,
                  turnNumber: this.turnNumber + 1,
                },
                model: {
                  id: effectiveModel.id,
                  provider: effectiveModel.provider,
                  apiPattern: effectiveModel.api.pattern,
                },
                ...(gateConverted.usage && { usage: gateConverted.usage }),
              } as any;
              this.messageHistory.push(gateAssistantMessage);
              await this.historyStore.appendMessage(this.currentSessionId, gateAssistantMessage);
              currentAssistantMessage = gateAssistantMessage as any;
              currentAssistantCanonicalMessage = gateAssistantCanonical;
              continue;
            }
          }

          // Emit a cortex-channel review-record for this finalized tool turn
          // (Router-shaped, nexus-DBAI-ingestion-compatible). outcome_score
          // IS the deterministic verdict — the slot the nexus schema reserves
          // ("alignment scorer / CHALLENGE-graded review") but leaves empty.
          // Fail-safe: training telemetry must never break a turn.
          if (turnUsedTools) {
            try {
              const draftText = Array.isArray(currentAssistantCanonicalMessage.content)
                ? (currentAssistantCanonicalMessage.content as any[])
                    .filter((b: any) => b?.type === 'text')
                    .map((b: any) => b.text || '')
                    .join('\n')
                : String(currentAssistantCanonicalMessage.content ?? '');
              // Audit ON → graded outcome. Audit OFF (no EndTurn) → a
              // DETERMINISTIC-only score: fraction of the answer's
              // line-number claims that correspond to a real line in this
              // turn's cat -n reads (not a flat 0). With the ReadFileTool
              // root-cause fix the model transcribes real numbers → ~1.0.
              const outcomeScore = !endTurnCalled
                ? deterministicCoordinateScore(draftText, thisTurnToolOutputs.join('\n'))
                : stage3Violations.length > 0
                  ? 0.3
                  : endTurnNudges > 0
                    ? 0.7
                    : 1.0;
              // Derive this turn's user prompt from history (most recent real
              // user message — not a tool_result or system-reminder injection).
              let userPrompt = '';
              for (let i = this.messageHistory.length - 1; i >= 0; i--) {
                const m: any = this.messageHistory[i];
                if (!(m?.type === 'user' || m?.message?.role === 'user')) continue;
                const c = m?.message?.content;
                if (typeof c === 'string') { userPrompt = c; break; }
                if (Array.isArray(c)) {
                  if (c.some((b: any) => b?.type === 'tool_result')) continue;
                  const txt = c.filter((b: any) => b?.type === 'text').map((b: any) => b.text || '').join('\n');
                  if (txt && !txt.trim().startsWith('<system-reminder>')) { userPrompt = txt; break; }
                }
              }
              const sample = buildRouterSample({
                decisionId: `cortex-${this.currentSessionId}-${this.turnNumber}-${uuidv4().slice(0, 8)}`,
                sessionId: this.currentSessionId,
                inputContext: userPrompt.slice(0, 2000),
                selectedTool: endTurnLastToolName ?? null,
                selectedArgsJson: JSON.stringify({
                  endTurnCalled,
                  endTurnNudges,
                  stage3Violations,
                  citations: lastEndTurnCitations ?? [],
                  draftPreview: draftText.slice(0, 800),
                }),
                outcomeScore,
                trainingWeight: 1.0,
                timestampMs: Date.now(),
              });
              // PROJECT_ROOT is set by the server at startup (index.ts:20) and
              // is the only base reliably present in the stateless ephemeral
              // orchestrator (config.projectPath is unset there → was landing
              // at the server's cwd).
              const recRoot = process.env.PROJECT_ROOT || this.config.projectPath || this.config.workingDirectory || process.cwd();
              const recPath = pathJoin(recRoot, '.cortex', 'training', 'cortex-samples.jsonl');
              appendJsonlRotating(recPath, JSON.stringify(sample));
            } catch (recErr) {
              if (this.config.debug) console.warn('[Orchestrator] cortex review-record emit failed (non-fatal):', recErr);
            }
          }

          if (this.config.debug && toolCallIteration > 0) {
            console.log(`[Orchestrator Phase 2.5] Multi-turn loop completed after ${toolCallIteration} iteration(s)`);
          }
          break;
        }

        // Track these tool uses for the response
        allExecutedToolUses.push(...toolUseBlocks);

        // Track per-tool call counts for diversity warning
        for (const tu of toolUseBlocks) {
          toolCallCounts.set(tu.name, (toolCallCounts.get(tu.name) || 0) + 1);
          // Stage 2: calling EndTurn is NOT sufficient — its citations must
          // verify against this turn's tool output (set post-execution
          // below). A non-EndTurn tool arms the gate + records category.
          if (tu.name !== 'EndTurn') {
            turnUsedTools = true;
            endTurnLastToolName = tu.name; // last real tool — for cortex record
            if (['Edit', 'Write', 'Bash', 'NotebookEdit'].includes(tu.name)) {
              turnUsedMutatingTool = true;
            }
            if (['Read', 'Grep', 'Glob'].includes(tu.name)) {
              turnUsedReadishTool = true;
            }
          }
        }

        toolCallIteration++;

        if (this.config.debug) {
          console.log(`[Orchestrator Phase 2.5] Iteration ${toolCallIteration}: Model requested ${toolUseBlocks.length} tool call(s)`);
        }

        // Loop detection: Check if we're repeating the same tool calls
        for (const toolUse of toolUseBlocks) {
          // Create a hash of tool name + input for comparison
          const inputHash = JSON.stringify(toolUse.input);
          const toolSignature = { name: toolUse.name, inputHash };

          recentToolCalls.push(toolSignature);

          // Check for loops: count how many times this exact call appears in recent history
          const matchCount = recentToolCalls.filter(
            call => call.name === toolUse.name && call.inputHash === inputHash
          ).length;

          if (matchCount >= MAX_LOOP_REPETITIONS) {
            console.warn(
              `[Orchestrator Phase 2.5] Loop detected: Tool "${toolUse.name}" called ${matchCount} times with same input. Stopping to prevent infinite loop.`
            );
            console.warn(`[Orchestrator Phase 2.5] Repeated input: ${inputHash.substring(0, 100)}...`);

            // Break out of the main while loop
            toolCallIteration = MAX_TOOL_ITERATIONS;
            break;
          }
        }

        // Guard: if loop detection fired, actually exit the outer while loop.
        // Without this, `break` above only exits the inner for, and the full tool
        // batch still executes this iteration (defeats loop prevention).
        // Orphaned tool_use blocks are handled by orphan-recovery at loop exit.
        if (toolCallIteration >= MAX_TOOL_ITERATIONS) {
          break;
        }

        // Phase 2.5 Day 3: Execute tools with timeout support
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          console.warn(`[Orchestrator Phase 2.5] Tool execution timeout after ${TOOL_TIMEOUT_MS}ms`);
          abortController.abort();
        }, TOOL_TIMEOUT_MS);

        // Track which tool_use_ids have been processed to avoid duplicates in error handler
        const processedToolUseIds = new Set<string>();

        try {
          const toolResults = await this.handleToolCalls(toolUseBlocks, abortController.signal);
          clearTimeout(timeoutId);

          // R21 (2026-05-15): MAX_CONSECUTIVE_ERRORS now counts CONSECUTIVE
          // ITERATIONS WITH ZERO SUCCESSFUL TOOLS, not cumulative individual
          // failures. Parallel-heavy models (grok-4-1-fast-reasoning emits
          // 7-11 tools/iter) used to trip the threshold from exploration
          // noise — 2/6 failed in iter 1 + 1/11 in iter 2 = 3 cumulative =
          // loop killed before any code produced, even though 14/17 tools
          // succeeded. New rule: as long as ≥1 tool succeeded in the
          // iteration, the model is making progress — reset the counter.
          const errorCount = toolResults.filter(r => r.is_error).length;
          const successCount = toolResults.length - errorCount;
          if (errorCount > 0) {
            console.warn(`[Orchestrator Phase 2.5] ${errorCount}/${toolResults.length} tool(s) failed in iteration ${toolCallIteration}`);
          }
          if (toolResults.length > 0 && successCount === 0) {
            // All tools failed — model not making progress
            totalToolErrors++;
            if (totalToolErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.error(`[Orchestrator Phase 2.5] ${totalToolErrors} consecutive all-fail iterations, stopping loop`);
              // Still process the error results to send back to the model
            }
          } else if (successCount > 0) {
            // At least one tool succeeded — model is making progress
            if (totalToolErrors > 0 && this.config.debug) {
              console.log(`[Orchestrator Phase 2.5] Error counter reset (${successCount}/${toolResults.length} tools succeeded)`);
            }
            totalToolErrors = 0;
          }

          // Stage 2: accumulate this turn's tool outputs (pre-pass so a
          // same-iteration Read is visible to a same-iteration EndTurn),
          // then verify any EndTurn call's citations against them. An
          // ungrounded verbatim_source is a regurgitated prior, not an
          // observation → reject the EndTurn (mutate its result into an
          // error the model must act on) and leave the gate unsatisfied.
          for (const tr of toolResults) {
            if (tr.tool_name === 'EndTurn' || tr.is_error) continue;
            const txt = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
            if (txt) thisTurnToolOutputs.push(txt);
          }
          for (const tr of toolResults) {
            if (tr.tool_name !== 'EndTurn') continue;
            const etUse = toolUseBlocks.find((t: any) => t.name === 'EndTurn');
            const cits = (etUse?.input as any)?.citations;
            lastEndTurnCitations = Array.isArray(cits) ? cits : undefined; // Stage 3 baseline
            const verdict = verifyCitationsGrounded(cits, thisTurnToolOutputs.join('\n'));
            if (verdict.grounded) {
              endTurnCalled = true;
            } else {
              const bad = verdict.ungrounded
                .map(u => ` - "${u.reference}" — not found in this turn's tool output: ${String(u.verbatim_source).slice(0, 120)}`)
                .join('\n');
              tr.is_error = true;
              tr.content =
                `end_turn REJECTED — these citations are not grounded in anything you read this turn:\n${bad}\n\n` +
                `A quote or coordinate you did not transcribe from this turn's tool output is a fabrication (a regurgitated guess), exactly like a non-matching edit old_string. ` +
                `Either RE-READ the exact region and copy the real text, or DELETE that reference from your answer (quote only code you can ground), then call end_turn again.`;
              console.warn(`[Orchestrator] Stage2: EndTurn rejected — ${verdict.ungrounded.length} ungrounded citation(s).`);
            }
          }

          // Create tool_result messages and add to history
          for (const toolResult of toolResults) {
            const toolResultMessageId = uuidv4();
        const toolResultMessage: Message = {
          uuid: toolResultMessageId,
          timestamp: new Date().toISOString(),
          type: 'user', // tool_result messages have role 'user'
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolResult.tool_use_id,
              tool_name: toolResult.tool_name,
              content: toolResult.content,
              is_error: toolResult.is_error,
              metadata: toolResult.metadata
            }]
          },
          timeline: {
            sessionId: this.currentSessionId,
            conversationId: this.currentConversationId,
            turnNumber: this.turnNumber + 1
          },
          model: {
            id: model.id,
            provider: model.provider,
            apiPattern: model.api.pattern
          }
        };

        // Record in timeline
        this.sessionTimeline.recordMessage(toolResultMessageId, 'user');

        // Add to history
        this.messageHistory.push(toolResultMessage);

        // Save to persistent storage
        await this.historyStore.appendMessage(this.currentSessionId, toolResultMessage);

        // Mark this tool_use_id as processed
        processedToolUseIds.add(toolResult.tool_use_id);

        // Progressive filter: record tool use for deferred loading
        if (this.config.enableDeferredToolLoading) {
          this.toolFilter.recordToolUse(toolResult.tool_name);
          // Record discovered tools from SearchTools results
          if (toolResult.tool_name === 'SearchTools' && !toolResult.is_error) {
            const content = typeof toolResult.content === 'string'
              ? toolResult.content
              : JSON.stringify(toolResult.content);
            this.toolFilter.recordDiscoveredTools(content);
          }
        }

        // Mentorship: check sequential tool calls for CodeExecute nudge
        if (this.mentorshipMiddleware && this.config.enableLocalCodeExecution) {
          const nudge = this.mentorshipMiddleware.checkSequentialToolCalls(
            this.currentSessionId, toolResult.tool_name, true
          );
          if (nudge && this.config.debug) {
            console.log(`[Orchestrator Mentorship] Sequential call nudge: ${nudge}`);
          }
        }

        if (this.config.debug) {
          console.log(`[Orchestrator Phase 2.5] Tool result saved: ${toolResult.tool_use_id} (error: ${toolResult.is_error || false})`);
          console.log(`[Orchestrator DEBUG] tool_name: ${toolResult.tool_name}, has_metadata: ${!!toolResult.metadata}, has_diff: ${!!toolResult.metadata?.diff}`);
        }

        // Phase 2 Mentorship: Track error pattern for pattern detection
        if (toolResult.is_error) {
          const errorMessage = typeof toolResult.content === 'string'
            ? toolResult.content
            : JSON.stringify(toolResult.content);
          this.trackErrorPattern(errorMessage);
        }

        // Reactive Mentorship: Check if error should trigger mentorship (via middleware)
        const mentorshipToolResult: MentorshipToolResult = {
          tool_use_id: toolResult.tool_use_id,
          content: typeof toolResult.content === 'string'
            ? toolResult.content
            : JSON.stringify(toolResult.content),
          is_error: toolResult.is_error || false
        };

        const middlewareContext: MiddlewareContext = {
          sessionId: this.currentSessionId,
          conversationId: this.currentConversationId,
          turnNumber: this.turnNumber,
          modelId: this.currentModelId,
          config: this.config
        };

        const shouldTriggerMentorship = this.mentorshipMiddleware
          ? this.mentorshipMiddleware.shouldTriggerMentorship(mentorshipToolResult, middlewareContext)
          : false;

        if (shouldTriggerMentorship) {
          if (this.config.debug) {
            console.log(`[Orchestrator Mentorship] Error detected, generating guidance...`);
          }

          try {
            // Find the tool name from the tool use blocks
            const toolUse = toolUseBlocks.find(t => t.id === toolResult.tool_use_id);
            const toolName = toolUse?.name || 'unknown';

            // Phase 2 Mentorship: Check if pattern detection should trigger
            const errorMessage = typeof toolResult.content === 'string'
              ? toolResult.content
              : JSON.stringify(toolResult.content);
            const errorPattern = this.extractErrorPattern(errorMessage);

            if (this.shouldTriggerPatternDetection(errorPattern)) {
              // Pattern detected - use pattern detection guidance
              await this.handlePatternDetection(errorPattern);
            } else {
              // Regular error - use standard error guidance
              const guidance = await this.helperMiddleware.generateErrorGuidance({
                toolName,
                toolUseId: toolResult.tool_use_id,
                error: toolResult.content,
                recentHistory: this.messageHistory,
                helperModelId: this.config.reactiveMentorship?.helperModelId
              });

              // Inject thinking block
              await this.injectThinkingBlock(guidance, 'error');

              if (this.config.debug) console.log(`[Orchestrator Mentorship] Error guidance injected for tool: ${toolName}`);
            }
          } catch (error: any) {
            console.error(`[Orchestrator Mentorship] Failed to generate error guidance:`, error.message);
          }
        }
      }

      // Budget signal injection: append to last tool_result so model sees it in context.
      // Brake on the GREATER of round-trips and total tool calls: R29b was tuned on
      // serial-calling models (deepseek, ~1 call/iteration) where the two are equal,
      // but parallel-batching models (grok: e.g. 44 calls across 16 iterations) would
      // otherwise never trip an iteration-based budget. recentToolCalls grows once per
      // actual tool call (loop-detection truncation window removed in R14/R49), so its
      // length is the true call count.
      const effectiveToolBudgetCount = Math.max(toolCallIteration, recentToolCalls.length);
      // Compute progress once; it gates BOTH the firm 1.5x signal and the hard cap
      // so neither commands a still-advancing model to stop.
      const progressStalled = isToolProgressStalled(recentToolCalls);
      const budgetSignal = computeToolBudgetSignal(effectiveToolBudgetCount, TOOL_BUDGET_SOFT, progressStalled);
      const diversityWarning = this.getDiversityWarning(toolCallCounts);
      if (budgetSignal || diversityWarning) {
        const signals = [budgetSignal, diversityWarning].filter(Boolean).join('\n');
        const lastMsg = this.messageHistory[this.messageHistory.length - 1] as any;
        if (lastMsg?.message?.content?.[0]?.type === 'tool_result') {
          const block = lastMsg.message.content[0];
          const existing = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          block.content = existing + '\n\n' + signals;
        }
      }

      // R29b hard cap: a weaker model may ignore the firm budget reminders
      // and keep spinning (benchmark: deepseek 46 successful local calls,
      // 392s, zero deliverable). Force-stop at 2x the soft budget; the
      // post-loop R29a synthesis net then turns the gathered context into
      // an actual answer instead of returning a bare tool_use.
      // R29b hard cap is PROGRESS-GATED: force-stop only when the model is past
      // the budget AND cycling (re-issuing known calls). Diverse, advancing work
      // — a real long-running task — is never force-stopped here; it runs to
      // MAX_TOOL_ITERATIONS (the absolute ceiling). This prevents the flat cap
      // from severing legitimate long work just because it made many calls.
      if (effectiveToolBudgetCount >= TOOL_BUDGET_HARD && progressStalled) {
        console.warn(
          `[Orchestrator] R29b: hard cap + stalled progress ` +
          `(${effectiveToolBudgetCount} >= ${TOOL_BUDGET_HARD}; iterations=${toolCallIteration}, calls=${recentToolCalls.length}; ` +
          `recent calls cycling). Forcing synthesis.`,
        );
        break;
      }

      // Interleaved thinking: inject subtle reflection between tool iterations (iteration 2+)
      if (this.shouldUseInterleavedThinking() && this.helperMiddleware && toolCallIteration > 1) {
        try {
          const toolSummaries = toolResults.map((r: any) => ({
            toolName: r.tool_name || 'unknown',
            isError: r.is_error || false,
            summary: (typeof r.content === 'string' ? r.content : JSON.stringify(r.content)).slice(0, 200)
          }));

          const guidance = await this.helperMiddleware.generateInterleavedContinuationThinking({
            userMessage: userContent,
            toolResults: toolSummaries,
            iterationNumber: toolCallIteration,
            recentHistory: this.messageHistory,
            helperModelId: this.config.reactiveMentorship?.helperModelId
          });

          await this.injectThinkingBlock(guidance, 'interleaved');
          if (this.config.debug) console.log(`[Orchestrator Mentorship] Interleaved continuation thinking injected (iteration ${toolCallIteration})`);
        } catch (error: any) {
          console.error(`[Orchestrator Mentorship] Interleaved continuation thinking failed:`, error.message);
        }
      }

      // Send tool results back to model and get continuation response
      // Proactive context management - ensure history fits before continuation
      await this.ensureHistoryFitsModel(effectiveModel);

      // Re-filter tools after SearchTools discovery so newly discovered tools
      // are included in the continuation request's tools array
      if (this.config.enableDeferredToolLoading && !isPTCEnabled) {
        const beforeCount = toolsToUse.length;
        toolsToUse = this.toolFilter.getFilteredTools(allTools);
        if (this.config.debug && toolsToUse.length !== beforeCount) {
          console.log(`[Deferred] Tools re-filtered: ${beforeCount} → ${toolsToUse.length} (${toolsToUse.map(t => t.name).join(', ')})`);
        }
      }

      // Input-slicing for stateful Responses API: when previous_response_id is set,
      // send ONLY items added since that response (per XAI docs — the server already
      // has everything up to lastResponseId; re-sending duplicates confuses it and
      // wastes tokens/cache).
      const canSliceInput =
        this.lastResponseId !== null &&
        effectiveModel.api.pattern === 'responses' &&
        this.messageCountAtLastResponse > 0 &&
        this.messageCountAtLastResponse <= this.messageHistory.length;
      const continuationHistorySource = canSliceInput
        ? this.messageHistory.slice(this.messageCountAtLastResponse)
        : this.messageHistory;
      const continuationCanonicalHistory = this.convertToCanonicalMessages([...continuationHistorySource]);

      const continuationRequest = this.gatewayTranslation.prepareRequest(
        continuationCanonicalHistory,
        toolsToUse,
        effectiveModel,
        {
          temperature: options.parameters?.temperature,
          maxTokens: options.parameters?.maxTokens,
          topP: options.parameters?.topP,
          reasoningEffort: options.parameters?.reasoningEffort, // GPT-5.1 reasoning level
          stream: options.streaming,
          staticSystemPrompt: this.currentStaticSystemPrompt, // R28
          conversationId: this.currentConversationId // R28b
        }
      );

      // Stateful Responses API: chain with previous_response_id for server-side reasoning preservation
      if (this.lastResponseId && effectiveModel.api.pattern === 'responses') {
        continuationRequest.previousResponseId = this.lastResponseId;
      }

      if (canSliceInput && this.config.debug) {
        console.log(`[Orchestrator Phase 2.5] Input-sliced for previous_response_id: sent ${continuationHistorySource.length}/${this.messageHistory.length} messages`);
      }

      // Cache-routing conversation id
      continuationRequest.conversationId = this.currentSessionId;

      // PTC: Override tools with defer_loading + PTC system tools on continuation
      if (isPTCEnabled && toolsToUse && toolsToUse.length > 0) {
        continuationRequest.tools = this.gatewayTranslation.prepareToolsWithPTC(toolsToUse, effectiveModel);
        (continuationRequest.parameters as any).enablePTC = true;
      }

      if (this.config.debug) {
        console.log(`[Orchestrator Phase 2.5] Sending tool results back to model for continuation...`);
      }

      // Send continuation request with retry logic
      let continuationApiResponse;
      if (this.retryMiddleware) {
        const retryResult = await this.retryMiddleware.executeWithRetry(
          () => this.apiClient.sendRequest(continuationRequest, effectiveModel),
          'continuation_api_call'
        );

        continuationApiResponse = retryResult.result;

        // Log retry information if retries occurred
        if (this.config.debug && retryResult.attemptCount > 1) {
          console.log(`[Orchestrator] Continuation API call succeeded after ${retryResult.attemptCount} attempts`);
          console.log(`[Orchestrator] Total retry time: ${retryResult.totalDelayMs}ms`);
        }
      } else {
        // Fallback: direct call if middleware not available
        continuationApiResponse = await this.apiClient.sendRequest(continuationRequest, effectiveModel);
      }

      // Convert continuation response
      const continuationConvertedResponse = this.gatewayTranslation.convertResponse(
        continuationApiResponse.data,
        effectiveModel,
        {
          sessionId: this.currentSessionId,
          conversationId: this.currentConversationId,
          turnNumber: this.turnNumber + 1
        }
      );

      // Track continuation response ID for stateful chaining
      if (effectiveModel.api.pattern === 'responses' && continuationApiResponse.data?.id) {
        this.lastResponseId = continuationApiResponse.data.id;
        this.lastResponseIdProvider = effectiveModel.provider; // R20a
      }

      // Extract continuation assistant message
      if (!continuationConvertedResponse.messages || continuationConvertedResponse.messages.length === 0) {
        throw new Error('No continuation response from provider');
      }

      const continuationAssistantCanonicalMessage = continuationConvertedResponse.messages[0]!;
      const continuationAssistantMessageId = continuationAssistantCanonicalMessage.uuid;

      // Convert to Message type for history
      const continuationAssistantMessage: Message = {
        uuid: continuationAssistantMessageId,
        timestamp: continuationAssistantCanonicalMessage.timestamp,
        type: 'assistant',
        message: {
          role: 'assistant',
          content: continuationAssistantCanonicalMessage.content as any
        },
        timeline: {
          sessionId: this.currentSessionId,
          conversationId: this.currentConversationId,
          turnNumber: this.turnNumber + 1
        },
        model: {
          id: effectiveModel.id,
          provider: effectiveModel.provider,
          apiPattern: effectiveModel.api.pattern
        },
        ...(continuationConvertedResponse.usage && { usage: continuationConvertedResponse.usage })
      };

      // Record in timeline
      this.sessionTimeline.recordMessage(continuationAssistantMessageId, 'assistant');

      // Add to history
      this.messageHistory.push(continuationAssistantMessage);

      // Input-slicing checkpoint: server has "seen" everything up through this message.
      this.messageCountAtLastResponse = this.messageHistory.length;

      // Save to persistent storage
      await this.historyStore.appendMessage(this.currentSessionId, continuationAssistantMessage);

      // Accumulate + persist cache metrics from the continuation call. Tool-call
      // continuations produce their own cache-read/creation numbers; without this,
      // sessions with many tool iterations report only the initial-request metrics.
      if (continuationConvertedResponse.usage) {
        this.cacheMetricsAccumulator.addUsage(continuationConvertedResponse.usage, effectiveModel.provider);
        this.persistCacheMetrics(effectiveModel.id).catch(err => {
          if (this.config.debug) {
            console.warn('[Orchestrator] Failed to persist cache metrics (continuation):', err);
          }
        });
      }

          // Update current message for next iteration
          currentAssistantMessage = continuationAssistantMessage;
          currentAssistantCanonicalMessage = continuationAssistantCanonicalMessage;

          // Phase 2.5 Day 3: Stop if too many errors accumulated
          if (totalToolErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.warn(`[Orchestrator Phase 2.5] Stopping loop due to accumulated errors`);
            break;
          }

        } catch (toolError: any) {
          // Phase 2.5 Day 3: Handle timeout or execution errors
          clearTimeout(timeoutId);

          const errorMessage = toolError.message || 'Unknown error during tool execution';
          const isTimeout = toolError.name === 'AbortError';
          const errorContent = isTimeout
            ? `Tool execution timed out after ${TOOL_TIMEOUT_MS}ms. Try a different approach — use more targeted commands (narrow paths, add --max-count/head limits, filter early), break large work into smaller steps, or use a different tool. Repeating the same command will hit the same timeout.`
            : `Tool execution failed with exception: ${errorMessage}`;

          // CRITICAL FIX: Save error tool_results to prevent orphaned tool_use blocks
          // When handleToolCalls throws an exception, we must still save tool_results
          // to maintain conversation integrity (tool_use must always be followed by tool_result)
          // BUT: Skip tool_use_ids that already have results saved (to avoid duplicates)
          for (const toolUse of toolUseBlocks) {
            // Skip if this tool already has a result saved
            if (processedToolUseIds.has(toolUse.id)) {
              if (this.config.debug) {
                console.log(`[Orchestrator] Skipping error tool_result for ${toolUse.name} (${toolUse.id}) - already processed`);
              }
              continue;
            }

            const toolResultMessageId = uuidv4();
            const toolResultMessage: Message = {
              uuid: toolResultMessageId,
              timestamp: new Date().toISOString(),
              type: 'user',
              message: {
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: errorContent,
                  is_error: true
                }]
              },
              timeline: {
                sessionId: this.currentSessionId,
                conversationId: this.currentConversationId,
                turnNumber: this.turnNumber + 1
              },
              model: {
                id: model.id,
                provider: model.provider,
                apiPattern: model.api.pattern
              }
            };

            // Record in timeline
            this.sessionTimeline.recordMessage(toolResultMessageId, 'user');

            // Add to history
            this.messageHistory.push(toolResultMessage);

            // Save to persistent storage
            await this.historyStore.appendMessage(this.currentSessionId, toolResultMessage);

            if (this.config.debug) {
              console.log(`[Orchestrator] Saved error tool_result for failed tool: ${toolUse.name} (${toolUse.id})`);
            }
          }

          // Phase 2.8 / #21: classify error and bail on unrecoverable
          // shapes. Capacity errors (context / rate-limit) and structural
          // 400s (signature-less thinking, orphaned tool_result) both
          // produce the same failure on retry — burning iterations and
          // input tokens. The classifier was extracted to
          // `apiErrorClassifier.ts` for testability.
          const errorCategory = classifyApiError(errorMessage);
          if (errorCategory !== 'recoverable') {
            const label = errorCategory === 'structural'
              ? 'Structural request error'
              : 'Capacity error';
            console.error(`[Orchestrator Phase 2.8] Fatal API error (${label}), stopping loop:`, errorMessage);
            if (errorCategory === 'capacity') {
              console.error(`[Orchestrator Phase 2.8] Consider enabling message compaction or reducing tool output size`);
            } else {
              console.error(`[Orchestrator Phase 2.8] Unrecoverable request shape — retrying with the same history will produce the same error.`);
            }
            break;
          }

          if (toolError.name === 'AbortError') {
            console.error(`[Orchestrator Phase 2.5] Tool execution timed out — error tool_result sent to model for retry with different approach`);
          } else {
            console.error(`[Orchestrator Phase 2.5] Error in tool execution iteration ${toolCallIteration}:`, toolError.message);
          }

          // Increment error counter and decide whether to continue.
          // Timeouts count toward MAX_CONSECUTIVE_ERRORS — 3 consecutive timeouts will break the loop.
          // This lets the model recover from a slow command while still preventing runaway retry loops.
          totalToolErrors++;

          if (totalToolErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(`[Orchestrator Phase 2.5] Too many errors, stopping loop`);
            break;
          }

          // Continue to next iteration - model might recover
          if (this.config.debug) {
            console.log(`[Orchestrator Phase 2.5] Continuing to next iteration after error`);
          }
        }

      } catch (loopError: any) {
        // Phase 2.5 Day 3: Catch-all for unexpected errors in loop
        console.error(`[Orchestrator Phase 2.5] Unexpected error in multi-turn loop:`, loopError.message);

        // Break out of loop on unexpected errors
        break;
      }
    }

    // Warn if we hit max iterations
    if (toolCallIteration >= MAX_TOOL_ITERATIONS) {
      console.warn(`[Orchestrator Phase 2.5] Max tool iterations (${MAX_TOOL_ITERATIONS}) reached. Stopping loop.`);
    }

    // R29a: post-loop synthesis net. The tool loop can exit with the final
    // assistant turn being a bare tool_use / thinking-only and ZERO text for
    // ANY reason (MAX_CONSECUTIVE_ERRORS, loop detection, max iterations) —
    // not just the no-tool_use path R18b covers. Without this, the
    // orchestrator returns content=[tool_use] and the user gets nothing
    // (observed: deepseek-chat in the 6-surface benchmark, 16 tools, 0
    // deliverable). Force ONE tools-suppressed synthesis turn. Reuses the
    // R18b call pattern; convertToCanonicalMessages already backfills
    // orphaned tool_results so a trailing unexecuted tool_use is safe.
    // Edge case: the loop can also force-exit (loop detection / hard cap /
    // max iterations) while the final turn is a SHORT PREAMBLE + unexecuted
    // tool_use ("Let me search for X..." then a batch of tool calls). That has
    // visible text, so the bare !hasVisibleAssistantText check misses it and the
    // user gets a preamble instead of an answer. A trailing tool_use at the
    // post-loop point only happens on an abnormal exit (a normal completion
    // returns NO tool_use), so it is a reliable "interrupted mid-action" signal.
    if (shouldForceSynthesis(currentAssistantCanonicalMessage.content, emptyResponseRetryUsed)) {
      emptyResponseRetryUsed = true;
      console.warn(
        `[Orchestrator] R29a: loop exited without a delivered answer ` +
        `(iteration=${toolCallIteration}). Forcing one tools-suppressed synthesis turn.`,
      );
      try {
        const synthUserMessage: Message = {
          uuid: uuidv4(),
          timestamp: new Date().toISOString(),
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'text',
              text: '<system-reminder>You stopped without giving a final answer. Provide your complete answer now in plain text — summarize your findings and deliver the requested result. Do NOT call any tools.</system-reminder>',
            }],
          },
          timeline: {
            sessionId: this.currentSessionId,
            conversationId: this.currentConversationId,
            turnNumber: this.turnNumber + 1,
          },
          model: {
            id: effectiveModel.id,
            provider: effectiveModel.provider,
            apiPattern: effectiveModel.api.pattern,
          },
        } as any;
        this.messageHistory.push(synthUserMessage);
        await this.historyStore.appendMessage(this.currentSessionId, synthUserMessage);

        await this.ensureHistoryFitsModel(effectiveModel);
        const synthCanonicalHistory = this.convertToCanonicalMessages([...this.messageHistory]);
        const synthRequest = this.gatewayTranslation.prepareRequest(
          synthCanonicalHistory,
          [], // tools suppressed — the model MUST produce text, not call more tools
          effectiveModel,
          {
            temperature: options.parameters?.temperature,
            maxTokens: options.parameters?.maxTokens,
            topP: options.parameters?.topP,
            reasoningEffort: options.parameters?.reasoningEffort,
            stream: options.streaming,
            staticSystemPrompt: this.currentStaticSystemPrompt, // R28
            conversationId: this.currentConversationId, // R28b
          },
        );
        if (this.lastResponseId && effectiveModel.api.pattern === 'responses') {
          synthRequest.previousResponseId = this.lastResponseId;
        }
        synthRequest.conversationId = this.currentSessionId;

        let synthApiResponse;
        if (this.retryMiddleware) {
          const synthResult = await this.retryMiddleware.executeWithRetry(
            () => this.apiClient.sendRequest(synthRequest, effectiveModel),
            'r29a_synthesis_retry',
          );
          synthApiResponse = synthResult.result;
        } else {
          synthApiResponse = await this.apiClient.sendRequest(synthRequest, effectiveModel);
        }

        const synthConverted = this.gatewayTranslation.convertResponse(
          synthApiResponse.data,
          effectiveModel,
          {
            sessionId: this.currentSessionId,
            conversationId: this.currentConversationId,
            turnNumber: this.turnNumber + 1,
          },
        );

        if (effectiveModel.api.pattern === 'responses' && synthApiResponse.data?.id) {
          this.lastResponseId = synthApiResponse.data.id;
          this.lastResponseIdProvider = effectiveModel.provider; // R20a
        }

        if (synthConverted.messages && synthConverted.messages.length > 0) {
          const synthAssistantCanonical = synthConverted.messages[0]!;
          const synthAssistantMessage: Message = {
            uuid: synthAssistantCanonical.uuid,
            timestamp: synthAssistantCanonical.timestamp,
            type: 'assistant',
            message: {
              role: 'assistant',
              content: synthAssistantCanonical.content as any,
            },
            timeline: {
              sessionId: this.currentSessionId,
              conversationId: this.currentConversationId,
              turnNumber: this.turnNumber + 1,
            },
            model: {
              id: effectiveModel.id,
              provider: effectiveModel.provider,
              apiPattern: effectiveModel.api.pattern,
            },
            ...(synthConverted.usage && { usage: synthConverted.usage }),
          } as any;
          this.messageHistory.push(synthAssistantMessage);
          await this.historyStore.appendMessage(this.currentSessionId, synthAssistantMessage);
          this.sessionTimeline.recordMessage(synthAssistantMessage.uuid, 'assistant');
          if (synthConverted.usage) {
            this.cacheMetricsAccumulator.addUsage(synthConverted.usage, effectiveModel.provider);
          }
          currentAssistantMessage = synthAssistantMessage as any;
          currentAssistantCanonicalMessage = synthAssistantCanonical;
        }
      } catch (synthErr: any) {
        // Synthesis is best-effort: a failure must not crash the turn. Return
        // whatever the loop produced (still no text, but no worse than before).
        console.warn(`[Orchestrator] R29a synthesis turn failed: ${synthErr?.message || synthErr}`);
      }
    }

    // Clean up ephemeral mentorship messages — they served their purpose during this turn
    this.cleanupEphemeralMessages();

    // 15. Update turn number
    this.turnNumber += 2; // User + Assistant

    // Phase 2.4: Extract server-side tool metadata (if applicable)
    const serverSideMetadata = extractServerSideMetadata(effectiveModel.provider, apiResponse.data);
    if (this.config.debug) console.log('[Orchestrator] Server-side metadata extracted:', serverSideMetadata ? 'YES' : 'NO');

    if (serverSideMetadata && this.config.debug) {
      console.log('[Orchestrator] Server-side tool metadata detected:', {
        autonomousExecution: serverSideMetadata.autonomousExecution,
        toolCalls: serverSideMetadata.toolCalls.length,
        citations: serverSideMetadata.citations?.length || 0,
        toolUsage: Object.keys(serverSideMetadata.toolUsage).length
      });
    }

    // 16a. Auto-record turn metrics into the routing matrix (fire-and-forget)
    if (this.config.modelRouter?.autoRecord) {
      try {
        const classification = classifyTask(userContent);
        const usage = convertedResponse.usage || { inputTokens: 0, outputTokens: 0 };
        const rawContent = currentAssistantCanonicalMessage.content as unknown;
        const hasText = typeof rawContent === 'string'
          ? (rawContent as string).length > 0
          : hasVisibleAssistantText(rawContent as any[]);
        this.getRouterMatrix().record({
          modelId: model.id,
          taskType: classification.taskType,
          toolCallCount: toolCallIteration,
          inputTokens: usage.inputTokens || 0,
          outputTokens: usage.outputTokens || 0,
          latencyMs: Date.now() - turnStartMs,
          pass: hasText,
          qualitativeScore: hasText ? 75 : 0,
        });
      } catch (routerErr: unknown) {
        console.warn('[ModelRouter] Auto-record failed:', (routerErr as Error)?.message || routerErr);
      }
    }

    // 16a. Turn summary & prediction (fire-and-forget-ish, but we await to include in response)
    let turnSummaryData: { summary: string; prediction: string } | undefined;
    if (process.env.TURN_SUMMARY_PREDICTION === 'true' && this.helperMiddleware) {
      try {
        const assistantText = Array.isArray(currentAssistantCanonicalMessage.content)
          ? (currentAssistantCanonicalMessage.content as any[])
              .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
              .map((b: any) => b.text)
              .join('')
          : String(currentAssistantCanonicalMessage.content ?? '');
        const toolNames = allExecutedToolUses.map((t: any) => t.name);
        turnSummaryData = await this.helperMiddleware.generateTurnSummaryAndPrediction({
          lastAssistantText: assistantText,
          lastUserText: userContent,
          toolsUsed: toolNames,
        });
      } catch (err: unknown) {
        if (this.config.debug) {
          console.warn('[Orchestrator] Turn summary generation failed:', (err as Error)?.message);
        }
      }
    }

    // 16. Build orchestrator response (use final message from multi-turn loop)
    // Include all executed tool uses from all iterations (not just final message)
    return {
      messageId: currentAssistantMessage.uuid,
      content: currentAssistantCanonicalMessage.content,
      toolUses: allExecutedToolUses,
      usage: convertedResponse.usage || {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      model: {
        id: model.id,
        provider: model.provider
      },
      metadata: {
        conversationId: this.currentConversationId,
        usedHelperModel,
        compactionTriggered: usedHelperModel,
        serverSideTools: serverSideMetadata || undefined,
        // Phase 2.5 Day 2: Multi-turn tool execution metadata
        toolCallIterations: toolCallIteration,
        multiTurnToolExecution: toolCallIteration > 0,
        ...(usedHelperModel ? helperModelMetadata : {}),
        ...(turnSummaryData ? {
          turnSummary: turnSummaryData.summary,
          nextActionPrediction: turnSummaryData.prediction,
        } : {}),
      }
    };
  }

  /**
   * Stream a message response with real-time chunks
   *
   * Phase 2.7: True Streaming Implementation
   * - Yields chunks in real-time for UI updates
   * - Uses SDK streaming (Anthropic MessageStream, OpenAI stream)
   * - Gets final accumulated message from SDK
   * - Uses EXISTING adapter conversion for final message
   * - Saves to history using EXISTING flow
   */
  async *streamMessage(
    content: string | any[],
    options: SendMessageOptions = {}
  ): AsyncGenerator<StreamChunk, void, unknown> {
    // Validate session initialized
    if (!this.currentSessionId || !this.sessionTimeline) {
      throw new Error('Session not initialized. Call createSession() first.');
    }

    const turnStartMs = Date.now();

    // Responses API chain — preserve across user turns (same as sendMessage path).
    // Input slicing now ensures we send only new items when previousResponseId is set.

    // 1-6. Same preparation as sendMessage (lines 340-404)
    // Get model
    const modelId = options.modelId || this.currentModelId;
    if (!modelId) {
      throw new Error('No model specified and no current model set');
    }

    // Central lookup — includes the back-compat alias fallback (deprecated
    // names like deepseek-chat resolve to their successor cards).
    const model = this.getModel(modelId);

    // === MENTORSHIP HOOKS (mirroring sendMessage lines 501-538) ===

    // 1. Periodic review check
    if (this.shouldTriggerPeriodicReview()) {
      await this.handlePeriodicReview();
    }

    // 2. Keyword detection (@ultrathink, @analyze, @rethink, @mentor)
    const mentorshipKeyword = this.detectMentorshipKeyword(content);
    if (mentorshipKeyword) {
      if (this.config.debug) {
        console.log(`[Orchestrator Streaming Mentorship] Detected keyword: ${mentorshipKeyword}`);
      }

      // Remove keyword from content
      content = this.removeKeyword(content, mentorshipKeyword);

      // Generate mentorship guidance
      try {
        const guidance = await this.helperMiddleware.generateKeywordGuidance({
          keyword: mentorshipKeyword,
          recentHistory: this.messageHistory,
          helperModelId: this.config.reactiveMentorship?.helperModelId
        });

        await this.injectThinkingBlock(guidance, 'keyword');
        if (this.config.debug) console.log(`[Orchestrator Streaming Mentorship] Keyword guidance injected`);
      } catch (error: any) {
        console.error(`[Orchestrator Streaming Mentorship] Keyword guidance failed:`, error.message);
      }
    }

    // 3. Interleaved thinking for non-reasoning models
    const userContent = typeof content === 'string' ? content : JSON.stringify(content);
    if (this.shouldUseInterleavedThinking() && !mentorshipKeyword) {
      await this.handleInterleavedThinking(userContent);
    }

    // 4. Active Discovery guidance (works for ALL models)
    if (this.config.reactiveMentorship?.activeDiscovery && this.helperMiddleware) {
      const filesRead = this.extractFilesReadFromHistory(this.messageHistory);
      try {
        const guidance = await this.helperMiddleware.generateActiveDiscoveryGuidance({
          userMessage: userContent,
          recentHistory: this.messageHistory,
          filesRead,
          helperModelId: this.config.reactiveMentorship?.helperModelId
        });

        await this.injectThinkingBlock(guidance, 'active_discovery');
      } catch {
        // Active Discovery guidance is best-effort — failures are non-critical
      }
    }

    // === END MENTORSHIP HOOKS ===

    // Get tools (needed for middleware injection decision)
    const endTurnGateOn2 = (process.env.CORTEX_ENDTURN_GATE) === 'true';
    const factoryTools = this.applyBaseToolAllowlist(
      endTurnGateOn2
        ? toolFactory.getAllTools()
        : toolFactory.getAllTools().filter(t => t.name !== 'EndTurn'),
    );
    const mcpTools = this.mcpAutoInject ? this.getMcpToolsAsCanonical() : [];
    const mcpManagementTools = this.getMcpManagementTools();
    const contextManagementTools = this.getContextManagementTools();
    const allTools = options.tools !== undefined
      ? [...factoryTools, ...mcpTools, ...mcpManagementTools, ...contextManagementTools, ...options.tools]
      : [...factoryTools, ...mcpTools, ...mcpManagementTools, ...contextManagementTools];

    // Phase 2.3: Inject server-side tools when enabled and model supports them
    // R20: provider-aware (streaming path mirror of non-streaming injection above).
    if (isServerSideToolsEnabled() && modelSupportsServerSideTools(model)) {
      let serverTools: ReturnType<typeof toCanonicalTool>[] = [];
      if (model.provider === 'xai') {
        serverTools = [
          toCanonicalTool(XAIServerSideTools.webSearch()),
          toCanonicalTool(XAIServerSideTools.xSearch()),
          toCanonicalTool(XAIServerSideTools.codeExecution()),
        ];
      } else if (model.provider === 'openai') {
        // R20b: only auto-inject hosted tools that work without per-request user
        // config. file_search needs vector_store_ids (unknown at injection time);
        // omit from defaults — user can request it explicitly via options.tools.
        // code_interpreter gets `container: { type: 'auto' }` injected by ResponsesAPIAdapter.
        serverTools = [
          toCanonicalTool(OpenAIServerSideTools.webSearch()),
          toCanonicalTool(OpenAIServerSideTools.codeInterpreter()),
          toCanonicalTool(OpenAIServerSideTools.imageGeneration()),
        ];
      }
      if (serverTools.length > 0) {
        allTools.push(...serverTools);
        if (this.config.debug) {
          console.log(`[Orchestrator Streaming Phase 2.3] Injected ${serverTools.length} ${model.provider} server-side tools: ${serverTools.map(t => t.name).join(', ')}`);
        }
      }
    }

    const hasTools = allTools !== undefined && allTools.length > 0;

    // Compute actual tool token count for accurate context budgeting.
    this.currentToolTokens = hasTools
      ? Math.ceil(JSON.stringify(allTools).length / 4)
      : 0;

    // System message injection (BEFORE creating user message)
    let injectedContent: string | any[];
    if (this.systemMessageMiddleware) {
      const middlewareContext: MiddlewareContext = {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber,
        // Use the RESOLVED model for this request, not the session default —
        // {{modelId}} in the system prompt must reflect the model actually
        // serving the turn (e.g. a per-request model override).
        modelId: model.id,
        config: this.config
      };

      const split = await this.systemMessageMiddleware.injectWithSystemSplit(
        content,
        model,
        hasTools,
        middlewareContext
      );
      injectedContent = split.userContent;
      this.currentStaticSystemPrompt = pinStaticSystemPrompt(
        this.staticSystemPromptByConversation,
        this.currentConversationId,
        split.systemPrompt
      );
    } else {
      injectedContent = content;
      this.currentStaticSystemPrompt = undefined;
    }

    // R42: MCP tool announcement (same as sendMessage path)
    if (mcpTools.length > 0 && this.turnNumber === 0) {
      const serverGroups = new Map<string, string[]>();
      for (const t of mcpTools) {
        const server = (t as any).serverName || 'unknown';
        if (!serverGroups.has(server)) serverGroups.set(server, []);
        serverGroups.get(server)!.push(t.name);
      }
      const lines: string[] = ['# MCP Server Instructions\n\nThe following MCP servers are connected and their tools are available:'];
      for (const [server, tools] of serverGroups) {
        lines.push(`\n## ${server}\n${tools.length} tools: ${tools.join(', ')}`);
      }
      const mcpAnnouncement = `<harness-note source="automated-harness" from-user="false">\n${lines.join('\n')}\n</harness-note>`;
      if (Array.isArray(injectedContent)) {
        (injectedContent as any[]).unshift({ type: 'text', text: mcpAnnouncement });
      }
    }

    // R42: Slash command announcement (same as sendMessage path)
    if (this.turnNumber === 0) {
      const commands = slashCommandRegistry.getAllCommands();
      if (commands.length > 0) {
        const categoryGroups = new Map<string, string[]>();
        for (const cmd of commands) {
          if (!categoryGroups.has(cmd.category)) categoryGroups.set(cmd.category, []);
          const alias = cmd.altName ? ` (/${cmd.altName})` : '';
          categoryGroups.get(cmd.category)!.push(`/${cmd.name}${alias} — ${cmd.description}`);
        }
        const cmdLines: string[] = ['# Available Slash Commands\n'];
        for (const [category, cmds] of categoryGroups) {
          cmdLines.push(`## ${category}\n${cmds.join('\n')}`);
        }
        const cmdAnnouncement = `<harness-note source="automated-harness" from-user="false">\n${cmdLines.join('\n')}\n</harness-note>`;
        if (Array.isArray(injectedContent)) {
          (injectedContent as any[]).unshift({ type: 'text', text: cmdAnnouncement });
        }
      }
    }

    // Deferred tool loading: categorized announcement with descriptions so
    // the model can match user intent to tool names without needing full schemas.
    if (this.config.enableDeferredToolLoading && Array.isArray(injectedContent)) {
      const convention = model.tools?.namingConvention || 'PascalCase';
      const announcement = this.buildDeferredToolAnnouncement(convention);
      if (announcement) {
        (injectedContent as any[]).unshift({ type: 'text', text: announcement });
      }
    }

    // Repository state (git + cross-agent staleness) — every turn.
    this.injectRepoStateNote(injectedContent);
    this.injectAutoResearchCapability(injectedContent);

    // Create user message (turn number will be current value, then incremented by 2 at end)
    // Save ORIGINAL content (not injected) to persistent storage
    const userMessageId = uuidv4();
    const userMessage: Message = {
      uuid: userMessageId,
      timestamp: new Date().toISOString(),
      type: 'user',
      message: {
        role: 'user',
        content: content as any // ORIGINAL content without system-reminder tags
      },
      timeline: {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber
      },
      model: {
        id: model.id,
        provider: model.provider,
        apiPattern: model.api.pattern
      }
    };

    this.sessionTimeline.recordMessage(userMessageId, 'user');
    this.messageHistory.push(userMessage);
    await this.historyStore.appendMessage(this.currentSessionId, userMessage);

    // Auto-generate session title on first turn (fire-and-forget)
    if (this.turnNumber === 0 && this.helperMiddleware) {
      this.generateAndSaveSessionTitle(userContent).catch(() => {});
    }

    // Proactive context management - ensure history fits before streaming
    await this.ensureHistoryFitsModel(model);

    // Convert history to canonical messages for API
    // Use injected content for the last message (current user message)
    const messageHistoryForApi = [...this.messageHistory];
    const userMessageForApi: Message = {
      ...userMessage,
      message: {
        role: 'user',
        content: injectedContent // Use injected content for API
      }
    };
    messageHistoryForApi[messageHistoryForApi.length - 1] = userMessageForApi;

    // canonicalHistory computed after effectiveModel is determined (input-slicing below).

    // Tools already gathered above for middleware injection

    // Server-side tool detection
    let serverSideDetection = null;
    let effectiveModel = model;

    if (allTools && allTools.length > 0) {
      serverSideDetection = shouldUseServerSideTools(model, allTools);
      if (serverSideDetection.useServerSideTools) {
        effectiveModel = {
          ...model,
          api: {
            ...model.api,
            pattern: serverSideDetection.apiPattern,
            endpoint: serverSideDetection.endpoint
          },
          tools: {
            ...model.tools,
            adapter: 'ResponsesAPIAdapter'
          }
        };
      }
    }

    let toolsToUse = serverSideDetection ? serverSideDetection.tools : allTools;

    // Check if PTC should be used for this request (streaming)
    const isPTCEnabled = this.config.enablePTC && effectiveModel.supportsPTC && effectiveModel.provider === 'anthropic';

    // Deferred loading: filter tools for non-PTC paths (essential + recently-used only)
    if (!isPTCEnabled && this.config.enableDeferredToolLoading && toolsToUse && toolsToUse.length > 0) {
      toolsToUse = this.toolFilter.getFilteredTools(toolsToUse);
    }

    // Reset sequential call counter at start of each user turn
    this.mentorshipMiddleware?.resetSequentialCalls(this.currentSessionId);

    // Input-slicing at initial (streaming) request: send only items since last checkpoint
    // when the effective API is Responses and lastResponseId carries over cross-turn.
    const initialCanSliceInputStreaming =
      this.lastResponseId !== null &&
      effectiveModel.api.pattern === 'responses' &&
      this.messageCountAtLastResponse > 0 &&
      this.messageCountAtLastResponse < messageHistoryForApi.length;
    const initialHistoryForApiStreaming = initialCanSliceInputStreaming
      ? messageHistoryForApi.slice(this.messageCountAtLastResponse)
      : messageHistoryForApi;
    const canonicalHistory = this.convertToCanonicalMessages(initialHistoryForApiStreaming);

    if (initialCanSliceInputStreaming && this.config.debug) {
      console.log(`[Orchestrator Streaming] Input-sliced initial for cross-turn chain: sent ${initialHistoryForApiStreaming.length}/${messageHistoryForApi.length} messages`);
    }

    // Prepare request
    const preparedRequest = this.gatewayTranslation.prepareRequest(
      canonicalHistory,
      toolsToUse,
      effectiveModel,
      {
        temperature: options.parameters?.temperature,
        maxTokens: options.parameters?.maxTokens,
        topP: options.parameters?.topP,
        reasoningEffort: options.parameters?.reasoningEffort, // GPT-5.1 reasoning level
        stream: true, // Enable streaming!
        staticSystemPrompt: this.currentStaticSystemPrompt, // R28
        conversationId: this.currentConversationId // R28b
      }
    );

    // Stateful Responses API: chain from prior response when available (cross-turn).
    if (this.lastResponseId && effectiveModel.api.pattern === 'responses') {
      preparedRequest.previousResponseId = this.lastResponseId;
    }

    // Cache-routing conversation id (streaming path)
    preparedRequest.conversationId = this.currentSessionId;

    // PTC: Override tools with defer_loading + PTC system tools
    if (isPTCEnabled && toolsToUse && toolsToUse.length > 0) {
      preparedRequest.tools = this.gatewayTranslation.prepareToolsWithPTC(toolsToUse, effectiveModel);
      (preparedRequest.parameters as any).enablePTC = true;
    }

    // 7. Stream request (NEW: Use streaming API)
    const streamingResponse = this.apiClient.streamRequest(preparedRequest, effectiveModel);

    // CRITICAL: Attach a catch handler to finalMessage immediately to prevent unhandled rejection
    // If stream is interrupted (ESC), the SDK may reject finalMessage after we've exited
    // This prevents the "unhandledRejection" crash while still allowing errors when awaited
    let finalMessageError: Error | null = null;
    streamingResponse.finalMessage.catch((err) => {
      finalMessageError = err;
      // Don't re-throw - just capture for later use if needed
    });

    // Track whether stream completed normally (vs interrupted by ESC/abort)
    let streamCompleted = false;

    // 8. Yield chunks in real-time
    try {
      for await (const chunk of streamingResponse.chunks) {
        if (this.config.debug) {
          console.log(`[Orchestrator] Yielding chunk type: ${chunk.type}, delta length: ${chunk.delta?.length || 0}`);
        }
        yield chunk;
      }
      streamCompleted = true;
    } catch (streamError) {
      // Stream was interrupted or errored - log but don't throw yet
      if (this.config.debug) {
        console.log(`[Orchestrator] Stream interrupted:`, streamError);
      }
    }

    // 9. Get final accumulated message (SDK accumulates internally)
    // Only await finalMessage if stream completed normally
    // If stream was interrupted (ESC), skip final processing to avoid hanging/errors
    if (!streamCompleted) {
      return; // Exit generator - don't save incomplete response
    }

    // Check if finalMessage already rejected (captured by catch handler above)
    if (finalMessageError) {
      throw finalMessageError;
    }

    const finalProviderMessage = await streamingResponse.finalMessage;

    // 10. Convert using EXISTING adapter conversion (CRITICAL!)
    let convertedResponse = this.gatewayTranslation.convertResponse(
      finalProviderMessage,
      effectiveModel,
      {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber + 1
      }
    );

    // Track initial streaming response ID for stateful chaining (XAI, OpenAI)
    if (effectiveModel.api.pattern === 'responses' && finalProviderMessage?.id) {
      this.lastResponseId = finalProviderMessage.id;
      this.lastResponseIdProvider = effectiveModel.provider; // R20a
      if (this.config.debug) {
        console.log(`[Orchestrator Streaming] Responses API response ID tracked: ${this.lastResponseId}`);
      }
    }

    // Phase 2.7: Track cache metrics (streaming path — persist AFTER history push below).
    if (convertedResponse.usage) {
      this.cacheMetricsAccumulator.addUsage(convertedResponse.usage, effectiveModel.provider);
      if (this.config.debug && convertedResponse.usage.cache) {
        console.log('[Orchestrator Cache] Cache hit detected (streaming):', {
          provider: effectiveModel.provider,
          cacheReadTokens: convertedResponse.usage.cache.cacheReadTokens,
          hitRate: (convertedResponse.usage.cache.cacheHitRate * 100).toFixed(1) + '%',
          costSavings: (convertedResponse.usage.cache.costSavingsRatio * 100).toFixed(1) + '%'
        });
      }
    }

    // 11-14. Save to history (EXACT SAME FLOW as sendMessage)
    if (!convertedResponse.messages || convertedResponse.messages.length === 0) {
      throw new Error('No response message returned from provider');
    }

    let currentAssistantCanonicalMessage = convertedResponse.messages[0]!;
    const assistantMessageId = currentAssistantCanonicalMessage.uuid;

    const assistantMessage: Message = {
      uuid: assistantMessageId,
      timestamp: currentAssistantCanonicalMessage.timestamp,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: currentAssistantCanonicalMessage.content as any // From adapter conversion!
      },
      timeline: {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber + 1
      },
      model: {
        id: effectiveModel.id,
        provider: effectiveModel.provider,
        apiPattern: effectiveModel.api.pattern
      },
      ...(convertedResponse.usage && { usage: convertedResponse.usage })
    };

    this.sessionTimeline.recordMessage(assistantMessageId, 'assistant');
    this.messageHistory.push(assistantMessage);
    // Input-slicing checkpoint (streaming initial)
    this.messageCountAtLastResponse = this.messageHistory.length;
    await this.historyStore.appendMessage(this.currentSessionId, assistantMessage);

    // Persist cache metrics + chain state — after checkpoint update.
    if (convertedResponse.usage) {
      this.persistCacheMetrics(effectiveModel.id).catch(err => {
        if (this.config.debug) {
          console.warn('[Orchestrator Streaming] Failed to persist cache metrics:', err);
        }
      });
    }

    // Phase 2.8: Multi-turn tool execution loop (STREAMING VERSION)
    // Matches sendMessage() pattern exactly (lines 800-1229), but with streaming
    let toolCallIteration = 0;
    let totalToolErrors = 0;
    let emptyResponseRetryUsed = false; // R32: parity with sendMessage R18b guard
    const allToolCalls: Array<{ name: string; inputHash: string }> = [];
    const allExecutedToolUses: any[] = [];
    const toolCallCounts = new Map<string, number>();

    // DEBUG: Log canonical message content structure for tool extraction (streaming path)
    if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
      const toolBlocks = currentAssistantCanonicalMessage.content.filter((b: any) => b.type === 'tool_use');
      if (toolBlocks.length > 0) {
        console.log(`[DEBUG Orchestrator Streaming] Tool blocks in canonical message:`,
          toolBlocks.map((b: any) => ({
            type: b.type,
            hasToolUse: !!b.toolUse,
            toolUseKeys: b.toolUse ? Object.keys(b.toolUse) : [],
            input: b.toolUse?.input,
            inputKeys: b.toolUse?.input ? Object.keys(b.toolUse.input) : []
          }))
        );
      }
    }

    // Extract tool uses from initial response
    const initialToolUseBlocks = currentAssistantCanonicalMessage.content
      .filter((block: any) => block.type === 'tool_use')
      .map((block: any) => ({
        id: block.toolUse.id,
        name: block.toolUse.name,
        input: block.toolUse.input
      }));
    let hasToolUse = initialToolUseBlocks.length > 0;

    // Loop control settings — single source of truth via getLoopControlConfig()
    const loopDefaults = this.getLoopControlConfig();
    const MAX_TOOL_ITERATIONS = loopDefaults.maxToolIterations;
    const MAX_CONSECUTIVE_ERRORS = loopDefaults.maxConsecutiveErrors;
    const MAX_LOOP_REPETITIONS = loopDefaults.maxLoopRepetitions;
    const TOOL_TIMEOUT_MS = loopDefaults.toolTimeoutMs;
    const TOOL_BUDGET_SOFT = loopDefaults.toolBudgetSoft; // R29b brake
    const TOOL_BUDGET_HARD = TOOL_BUDGET_SOFT * 2; // force-synthesis cap

    while (hasToolUse && toolCallIteration < MAX_TOOL_ITERATIONS) {
      toolCallIteration++;

      // Extract tool use blocks from current message
      const toolUseBlocks = currentAssistantCanonicalMessage.content
        .filter((block: any) => block.type === 'tool_use')
        .map((block: any) => ({
          id: block.toolUse.id,
          name: block.toolUse.name,
          input: block.toolUse.input
        }));

      if (toolUseBlocks.length === 0) {
        // R32 (streaming R18b parity): detect empty/thinking-only responses.
        // sendMessage retries ONCE inside the loop with tools preserved.
        const hasVisibleText = hasVisibleAssistantText(currentAssistantCanonicalMessage.content);
        if (!hasVisibleText && !emptyResponseRetryUsed) {
          emptyResponseRetryUsed = true;
          console.warn(
            `[Orchestrator Streaming] R32/R18b: Empty response (no tool_use, no text, iteration=${toolCallIteration}). ` +
            `Retrying once with tools preserved.`,
          );

          // R26 repair: ensure the empty assistant turn has content (xAI hard-400s on empty)
          for (let i = this.messageHistory.length - 1; i >= 0; i--) {
            const m: any = this.messageHistory[i];
            const isAssistant = m?.type === 'assistant' || m?.message?.role === 'assistant';
            if (!isAssistant) continue;
            const content = m?.message?.content;
            const isEmpty = !content
              || (Array.isArray(content) && content.length === 0)
              || (typeof content === 'string' && content.trim() === '');
            if (isEmpty) {
              m.message = m.message || { role: 'assistant' };
              m.message.content = [{ type: 'text', text: '(no output)' }];
            }
            break;
          }

          const followupUserMessage: Message = {
            uuid: uuidv4(),
            timestamp: new Date().toISOString(),
            type: 'user',
            message: {
              role: 'user',
              content: [{
                type: 'text',
                text: '<system-reminder>Your previous response had no visible text. Please provide your final answer in plain text now — summarize your findings or complete the requested task. Do not call any more tools.</system-reminder>',
              }],
            },
            timeline: {
              sessionId: this.currentSessionId,
              conversationId: this.currentConversationId,
              turnNumber: this.turnNumber + 1,
            },
            model: {
              id: effectiveModel.id,
              provider: effectiveModel.provider,
              apiPattern: effectiveModel.api.pattern,
            },
          } as any;

          this.messageHistory.push(followupUserMessage);
          await this.historyStore.appendMessage(this.currentSessionId, followupUserMessage);

          try {
            await this.ensureHistoryFitsModel(effectiveModel);
            const retryCanonicalHistory = this.convertToCanonicalMessages([...this.messageHistory]);
            const retryRequest = this.gatewayTranslation.prepareRequest(
              retryCanonicalHistory,
              toolsToUse,
              effectiveModel,
              {
                temperature: options.parameters?.temperature,
                maxTokens: options.parameters?.maxTokens,
                topP: options.parameters?.topP,
                reasoningEffort: options.parameters?.reasoningEffort,
                stream: false,
                staticSystemPrompt: this.currentStaticSystemPrompt,
                conversationId: this.currentConversationId,
              },
            );
            if (this.lastResponseId && effectiveModel.api.pattern === 'responses') {
              retryRequest.previousResponseId = this.lastResponseId;
            }
            retryRequest.conversationId = this.currentSessionId;

            let retryApiResponse;
            if (this.retryMiddleware) {
              const retryResult = await this.retryMiddleware.executeWithRetry(
                () => this.apiClient.sendRequest(retryRequest, effectiveModel),
                'r32_stream_empty_retry',
              );
              retryApiResponse = retryResult.result;
            } else {
              retryApiResponse = await this.apiClient.sendRequest(retryRequest, effectiveModel);
            }

            const retryConverted = this.gatewayTranslation.convertResponse(
              retryApiResponse.data,
              effectiveModel,
              {
                sessionId: this.currentSessionId,
                conversationId: this.currentConversationId,
                turnNumber: this.turnNumber + 1,
              },
            );

            if (effectiveModel.api.pattern === 'responses' && retryApiResponse.data?.id) {
              this.lastResponseId = retryApiResponse.data.id;
              this.lastResponseIdProvider = effectiveModel.provider;
            }

            if (retryConverted.messages && retryConverted.messages.length > 0) {
              const retryAssistantCanonical = retryConverted.messages[0]!;
              const retryAssistantMessage: Message = {
                uuid: retryAssistantCanonical.uuid,
                timestamp: retryAssistantCanonical.timestamp,
                type: 'assistant',
                message: {
                  role: 'assistant',
                  content: retryAssistantCanonical.content as any,
                },
                timeline: {
                  sessionId: this.currentSessionId,
                  conversationId: this.currentConversationId,
                  turnNumber: this.turnNumber + 1,
                },
                model: {
                  id: effectiveModel.id,
                  provider: effectiveModel.provider,
                  apiPattern: effectiveModel.api.pattern,
                },
                ...(retryConverted.usage && { usage: retryConverted.usage }),
              } as any;
              this.messageHistory.push(retryAssistantMessage);
              await this.historyStore.appendMessage(this.currentSessionId, retryAssistantMessage);

              currentAssistantCanonicalMessage = retryAssistantCanonical;

              // Yield any text from the retry as streaming chunks
              const retryText = (retryAssistantCanonical.content as any[])
                .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
                .map((b: any) => b.text)
                .join('');
              if (retryText.trim().length > 0) {
                yield { type: 'text_delta' as const, delta: retryText } as StreamChunk;
              }

              continue; // re-enter loop — retry may have produced tool_use
            }
          } catch (retryErr) {
            console.warn(`[Orchestrator Streaming] R32 retry failed:`, retryErr);
          }
        }

        hasToolUse = false;
        break;
      }

      // Track all tool uses
      allExecutedToolUses.push(...toolUseBlocks);

      // Track which tool_use_ids have been processed to avoid duplicates in error handler
      const processedToolUseIds = new Set<string>();

      // Check for loop repetitions (infinite loop detection)
      for (const toolUse of toolUseBlocks) {
        const inputHash = JSON.stringify(toolUse.input);
        allToolCalls.push({ name: toolUse.name, inputHash });

        const matchCount = allToolCalls.filter(
          call => call.name === toolUse.name && call.inputHash === inputHash
        ).length;

        if (matchCount >= MAX_LOOP_REPETITIONS) {
          if (this.config.debug) {
            console.warn(
              `[Orchestrator Streaming] Loop detected: Tool "${toolUse.name}" called ${matchCount} times with same input. Stopping.`
            );
          }
          toolCallIteration = MAX_TOOL_ITERATIONS; // Force exit
          break;
        }
      }

      // Guard: if loop detection fired, actually exit the outer while loop.
      // Without this, `break` above only exits the inner for, and the full tool
      // batch still executes this iteration (defeats loop prevention).
      // Orphaned tool_use blocks are handled by orphan-recovery at loop exit.
      if (toolCallIteration >= MAX_TOOL_ITERATIONS) {
        break;
      }

      // Execute tools with timeout
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        if (this.config.debug) {
          console.warn(`[Orchestrator Streaming] Tool execution timeout after ${TOOL_TIMEOUT_MS}ms`);
        }
        abortController.abort();
      }, TOOL_TIMEOUT_MS);

      try {
        // Execute tools (reuse existing method)
        const toolResults = await this.handleToolCalls(toolUseBlocks, abortController.signal);
        clearTimeout(timeoutId);

        // R21 (2026-05-15): same fix as non-streaming path — count consecutive
        // ITERATIONS WITH ZERO SUCCESSFUL TOOLS, not cumulative individual
        // failures. Reset whenever at least one tool succeeded.
        const errorCount = toolResults.filter(r => r.is_error).length;
        const successCount = toolResults.length - errorCount;
        if (errorCount > 0 && this.config.debug) {
          console.warn(`[Orchestrator Streaming] ${errorCount}/${toolResults.length} tool(s) failed in iteration ${toolCallIteration}`);
        }
        if (toolResults.length > 0 && successCount === 0) {
          totalToolErrors++;
          if (totalToolErrors >= MAX_CONSECUTIVE_ERRORS) {
            if (this.config.debug) {
              console.error(`[Orchestrator Streaming] ${totalToolErrors} consecutive all-fail iterations, stopping loop`);
            }
            break;
          }
        } else if (successCount > 0) {
          totalToolErrors = 0; // Reset — model is making progress
        }

        // Create tool_result messages and save to history
        for (const toolResult of toolResults) {
          // Emit tool result as streaming chunk for CLI display
          yield {
            type: 'tool_result' as const,
            toolResult: {
              tool_use_id: toolResult.tool_use_id,
              tool_name: toolResult.tool_name,
              content: toolResult.content,
              is_error: toolResult.is_error,
              metadata: toolResult.metadata
            }
          };

          const toolResultMessageId = uuidv4();
          const toolResultMessage: Message = {
            uuid: toolResultMessageId,
            timestamp: new Date().toISOString(),
            type: 'user', // tool_result messages have role 'user'
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: toolResult.tool_use_id,
                tool_name: toolResult.tool_name,
                content: toolResult.content,
                is_error: toolResult.is_error,
                metadata: toolResult.metadata
              }]
            },
            timeline: {
              sessionId: this.currentSessionId,
              conversationId: this.currentConversationId,
              turnNumber: this.turnNumber + 1
            },
            model: {
              id: model.id,
              provider: model.provider,
              apiPattern: model.api.pattern
            }
          };

          this.sessionTimeline.recordMessage(toolResultMessageId, 'user');
          this.messageHistory.push(toolResultMessage);
          await this.historyStore.appendMessage(this.currentSessionId, toolResultMessage);

          // Mark this tool_use_id as processed to prevent duplicate in error handler
          processedToolUseIds.add(toolResult.tool_use_id);

          // Progressive filter: record tool use for deferred loading (streaming)
          if (this.config.enableDeferredToolLoading) {
            this.toolFilter.recordToolUse(toolResult.tool_name);
            if (toolResult.tool_name === 'SearchTools' && !toolResult.is_error) {
              const content = typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content);
              this.toolFilter.recordDiscoveredTools(content);
            }
          }

          // Mentorship: check sequential tool calls for CodeExecute nudge (streaming)
          if (this.mentorshipMiddleware && this.config.enableLocalCodeExecution) {
            const nudge = this.mentorshipMiddleware.checkSequentialToolCalls(
              this.currentSessionId, toolResult.tool_name, true
            );
            if (nudge && this.config.debug) {
              console.log(`[Orchestrator Streaming Mentorship] Sequential call nudge: ${nudge}`);
            }
          }

          // Phase 2 Mentorship: Track error pattern for pattern detection (streaming)
          if (toolResult.is_error) {
            const errorMessage = typeof toolResult.content === 'string'
              ? toolResult.content
              : JSON.stringify(toolResult.content);
            this.trackErrorPattern(errorMessage);
          }

          // Reactive Mentorship: Check if error should trigger mentorship (streaming)
          const mentorshipToolResult: MentorshipToolResult = {
            tool_use_id: toolResult.tool_use_id,
            content: typeof toolResult.content === 'string'
              ? toolResult.content
              : JSON.stringify(toolResult.content),
            is_error: toolResult.is_error || false
          };

          const streamingMentorshipContext: MiddlewareContext = {
            sessionId: this.currentSessionId,
            conversationId: this.currentConversationId,
            turnNumber: this.turnNumber,
            modelId: this.currentModelId,
            config: this.config
          };

          const shouldTriggerStreamingMentorship = this.mentorshipMiddleware
            ? this.mentorshipMiddleware.shouldTriggerMentorship(mentorshipToolResult, streamingMentorshipContext)
            : false;

          if (shouldTriggerStreamingMentorship) {
            if (this.config.debug) {
              console.log(`[Orchestrator Streaming Mentorship] Error detected, generating guidance...`);
            }

            try {
              const toolUse = toolUseBlocks.find(t => t.id === toolResult.tool_use_id);
              const toolName = toolUse?.name || 'unknown';

              const errorMessage = typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content);
              const errorPattern = this.extractErrorPattern(errorMessage);

              if (this.shouldTriggerPatternDetection(errorPattern)) {
                await this.handlePatternDetection(errorPattern);
              } else {
                const guidance = await this.helperMiddleware.generateErrorGuidance({
                  toolName,
                  toolUseId: toolResult.tool_use_id,
                  error: toolResult.content,
                  recentHistory: this.messageHistory,
                  helperModelId: this.config.reactiveMentorship?.helperModelId
                });

                await this.injectThinkingBlock(guidance, 'error');
                if (this.config.debug) console.log(`[Orchestrator Streaming Mentorship] Error guidance injected for: ${toolName}`);
              }
            } catch (mentorError: any) {
              console.error(`[Orchestrator Streaming Mentorship] Error guidance failed:`, mentorError.message);
            }
          }
        }

        // Track per-tool call counts for diversity warning (streaming)
        for (const tu of toolUseBlocks) {
          toolCallCounts.set(tu.name, (toolCallCounts.get(tu.name) || 0) + 1);
        }

        // Budget signal injection (streaming path).
        // Brake on the GREATER of round-trips and total tool calls so parallel-
        // batching models (grok) trip the budget; serial models are unaffected
        // (iterations == calls). See sendMessage path for the full rationale.
        const effectiveToolBudgetCount = Math.max(toolCallIteration, allToolCalls.length);
        const progressStalled = isToolProgressStalled(allToolCalls);
        const budgetSignal = computeToolBudgetSignal(effectiveToolBudgetCount, TOOL_BUDGET_SOFT, progressStalled);
        const diversityWarning = this.getDiversityWarning(toolCallCounts);
        if (budgetSignal || diversityWarning) {
          const signals = [budgetSignal, diversityWarning].filter(Boolean).join('\n');
          const lastMsg = this.messageHistory[this.messageHistory.length - 1] as any;
          if (lastMsg?.message?.content?.[0]?.type === 'tool_result') {
            const block = lastMsg.message.content[0];
            const existing = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            block.content = existing + '\n\n' + signals;
          }
        }

        // R29b hard cap (streaming parity): force-stop at 2x soft budget;
        // the post-loop R29a streaming net then synthesizes a deliverable.
        // Progress-gated hard cap (parity with sendMessage): force-stop only when
        // past budget AND cycling; diverse advancing work runs to MAX_TOOL_ITERATIONS.
        if (effectiveToolBudgetCount >= TOOL_BUDGET_HARD && progressStalled) {
          console.warn(
            `[Orchestrator Streaming] R29b: hard cap + stalled progress ` +
            `(${effectiveToolBudgetCount} >= ${TOOL_BUDGET_HARD}; iterations=${toolCallIteration}, calls=${allToolCalls.length}; ` +
            `recent calls cycling). Forcing synthesis.`,
          );
          hasToolUse = false;
          break;
        }

        // Interleaved thinking: inject subtle reflection between tool iterations
        if (this.shouldUseInterleavedThinking() && this.helperMiddleware && toolCallIteration > 1) {
          try {
            const toolSummaries = toolResults.map((r: any) => ({
              toolName: r.tool_name || 'unknown',
              isError: r.is_error || false,
              summary: (typeof r.content === 'string' ? r.content : JSON.stringify(r.content)).slice(0, 200)
            }));

            const guidance = await this.helperMiddleware.generateInterleavedContinuationThinking({
              userMessage: userContent,
              toolResults: toolSummaries,
              iterationNumber: toolCallIteration,
              recentHistory: this.messageHistory,
              helperModelId: this.config.reactiveMentorship?.helperModelId
            });

            await this.injectThinkingBlock(guidance, 'interleaved');
            if (this.config.debug) console.log(`[Orchestrator Streaming Mentorship] Interleaved continuation thinking injected (iteration ${toolCallIteration})`);
          } catch (error: any) {
            console.error(`[Orchestrator Streaming Mentorship] Interleaved continuation thinking failed:`, error.message);
          }
        }

        // Send continuation request with tool results
        // Proactive context management - ensure history fits before streaming continuation
        await this.ensureHistoryFitsModel(effectiveModel);

        // Re-filter tools after SearchTools discovery (same as sendMessage path)
        if (this.config.enableDeferredToolLoading && !isPTCEnabled) {
          toolsToUse = this.toolFilter.getFilteredTools(allTools);
        }

        // Input-slicing for stateful Responses API (same logic as non-streaming path)
        const streamCanSliceInput =
          this.lastResponseId !== null &&
          effectiveModel.api.pattern === 'responses' &&
          this.messageCountAtLastResponse > 0 &&
          this.messageCountAtLastResponse <= this.messageHistory.length;
        const streamContinuationHistorySource = streamCanSliceInput
          ? this.messageHistory.slice(this.messageCountAtLastResponse)
          : this.messageHistory;
        const continuationCanonicalHistory = this.convertToCanonicalMessages([...streamContinuationHistorySource]);

        // Phase 2.8: Prepare continuation request
        // All providers maintain thinking throughout multi-turn execution
        const continuationRequest = this.gatewayTranslation.prepareRequest(
          continuationCanonicalHistory,
          toolsToUse, // Updated tools including SearchTools discoveries
          effectiveModel,
          {
            temperature: options.parameters?.temperature,
            maxTokens: options.parameters?.maxTokens,
            topP: options.parameters?.topP,
            reasoningEffort: options.parameters?.reasoningEffort, // GPT-5.1 reasoning level
            stream: true, // STREAMING continuation
            staticSystemPrompt: this.currentStaticSystemPrompt, // R28
            conversationId: this.currentConversationId, // R28b
            // Thinking enabled for all providers in continuations
            // This allows interleaved thinking during tool execution
          }
        );

        // Stateful Responses API: chain with previous_response_id for server-side reasoning preservation
        if (this.lastResponseId && effectiveModel.api.pattern === 'responses') {
          continuationRequest.previousResponseId = this.lastResponseId;
        }

        if (streamCanSliceInput && this.config.debug) {
          console.log(`[Orchestrator Streaming] Input-sliced for previous_response_id: sent ${streamContinuationHistorySource.length}/${this.messageHistory.length} messages`);
        }

        // Cache-routing conversation id (streaming continuation)
        continuationRequest.conversationId = this.currentSessionId;

        // PTC: Override tools with defer_loading + PTC system tools on streaming continuation
        if (isPTCEnabled && toolsToUse && toolsToUse.length > 0) {
          continuationRequest.tools = this.gatewayTranslation.prepareToolsWithPTC(toolsToUse, effectiveModel);
          (continuationRequest.parameters as any).enablePTC = true;
        }

        if (this.config.debug) {
          console.log(`[Orchestrator Streaming] Sending tool results back to model for continuation (iteration ${toolCallIteration})...`);
        }

        // NEW: Stream continuation response
        const continuationStreamingResponse = this.apiClient.streamRequest(continuationRequest, effectiveModel);

        // Yield a marker so CLI knows this is a continuation
        if (process.env.DEBUG_THINKING === 'true') {
          console.log(`\n[DEBUG Orchestrator] === CONTINUATION ${toolCallIteration} STARTING ===`);
        }

        // Yield continuation chunks in real-time
        for await (const chunk of continuationStreamingResponse.chunks) {
          yield chunk;
        }

        // Get final continuation message
        const continuationProviderMessage = await continuationStreamingResponse.finalMessage;

        // Validate continuation response (API pattern-aware)
        if (!continuationProviderMessage) {
          console.warn(`[Orchestrator Streaming] Continuation response is null/undefined. Stopping loop.`);
          break;
        }

        // API pattern-based validation (not provider-based)
        // Different API patterns have different response structures
        if (effectiveModel.api.pattern === 'generateContent') {
          // Gemini GenerateContent API uses candidates array
          if (!continuationProviderMessage.candidates || continuationProviderMessage.candidates.length === 0) {
            console.warn(`[Orchestrator Streaming] GenerateContent API continuation response has no candidates. Stopping loop.`);
            console.warn(`[Orchestrator Streaming] Response keys: ${JSON.stringify(Object.keys(continuationProviderMessage))}`);
            break;
          }

          const continuationFinishReason = continuationProviderMessage.candidates[0]?.finishReason;
          if (continuationFinishReason && continuationFinishReason !== 'STOP') {
            console.warn(`[Orchestrator Streaming] Continuation finishReason: ${continuationFinishReason}`);
            if (continuationFinishReason === 'SAFETY' || continuationFinishReason === 'RECITATION') {
              console.error(`[Orchestrator Streaming] Continuation was blocked by safety filters. Cannot continue.`);
              break;
            } else if (continuationFinishReason === 'MAX_TOKENS') {
              console.warn(`[Orchestrator Streaming] Continuation hit max tokens. Stopping tool loop.`);
              break;
            }
          }
        } else if (effectiveModel.api.pattern === 'messages') {
          // Messages API (used by Claude and Grok) uses stop_reason
          const stopReason = continuationProviderMessage.stop_reason;
          if (stopReason === 'max_tokens' || stopReason === 'length') {
            console.warn(`[Orchestrator Streaming] Messages API hit token limit (${stopReason}). Stopping tool loop.`);
            break;
          }
        } else if (effectiveModel.api.pattern === 'chat/completions') {
          // Chat Completions API (OpenAI, DeepSeek, Groq) uses choices array
          if (!continuationProviderMessage.choices || continuationProviderMessage.choices.length === 0) {
            console.warn(`[Orchestrator Streaming] Chat Completions API continuation response has no choices. Stopping loop.`);
            break;
          }

          const finishReason = continuationProviderMessage.choices[0]?.finish_reason;
          if (finishReason === 'length') {
            console.warn(`[Orchestrator Streaming] Chat Completions API hit max tokens. Stopping tool loop.`);
            break;
          }
        }

        // Convert continuation response
        const continuationConvertedResponse = this.gatewayTranslation.convertResponse(
          continuationProviderMessage,
          effectiveModel,
          {
            sessionId: this.currentSessionId,
            conversationId: this.currentConversationId,
            turnNumber: this.turnNumber + 1
          }
        );

        // Track streaming continuation response ID for stateful chaining
        if (effectiveModel.api.pattern === 'responses' && continuationProviderMessage?.id) {
          this.lastResponseId = continuationProviderMessage.id;
          this.lastResponseIdProvider = effectiveModel.provider; // R20a
        }

        const continuationAssistantCanonicalMessage = continuationConvertedResponse.messages[0]!;
        const continuationAssistantMessageId = continuationAssistantCanonicalMessage.uuid;

        // Save continuation to history
        const continuationMessage: Message = {
          uuid: continuationAssistantMessageId,
          timestamp: continuationAssistantCanonicalMessage.timestamp,
          type: 'assistant',
          message: {
            role: 'assistant',
            content: continuationAssistantCanonicalMessage.content as any
          },
          timeline: {
            sessionId: this.currentSessionId,
            conversationId: this.currentConversationId,
            turnNumber: this.turnNumber + 1
          },
          model: {
            id: effectiveModel.id,
            provider: effectiveModel.provider,
            apiPattern: effectiveModel.api.pattern
          },
          ...(continuationConvertedResponse.usage && { usage: continuationConvertedResponse.usage })
        };

        this.sessionTimeline.recordMessage(continuationAssistantMessageId, 'assistant');
        this.messageHistory.push(continuationMessage);
        // Input-slicing checkpoint (streaming continuation)
        this.messageCountAtLastResponse = this.messageHistory.length;
        await this.historyStore.appendMessage(this.currentSessionId, continuationMessage);

        // Accumulate + persist cache metrics from the streaming continuation call —
        // parity with sendMessage continuation; without this, streamed tool-loop
        // iterations don't add their cache numbers to the session total.
        if (continuationConvertedResponse.usage) {
          this.cacheMetricsAccumulator.addUsage(continuationConvertedResponse.usage, effectiveModel.provider);
          this.persistCacheMetrics(effectiveModel.id).catch(err => {
            if (this.config.debug) {
              console.warn('[Orchestrator Streaming] Failed to persist cache metrics (continuation):', err);
            }
          });
        }

        // Update for next iteration
        currentAssistantCanonicalMessage = continuationAssistantCanonicalMessage;

        // Check if continuation has more tool uses
        const continuationToolUses = continuationAssistantCanonicalMessage.content
          .filter((block: any) => block.type === 'tool_use')
          .map((block: any) => ({
            id: block.toolUse.id,
            name: block.toolUse.name,
            input: block.toolUse.input
          }));
        hasToolUse = continuationToolUses.length > 0;

        // Stop if too many errors
        if (totalToolErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.warn(`[Orchestrator Streaming] Stopping loop due to accumulated errors`);
          break;
        }

      } catch (toolError: any) {
        clearTimeout(timeoutId);

        const errorMessage = toolError.message || 'Unknown error during tool execution';
        const isTimeout = toolError.name === 'AbortError';
        const errorContent = isTimeout
          ? `Tool execution timed out after ${TOOL_TIMEOUT_MS}ms. Try a different approach — use more targeted commands (narrow paths, add --max-count/head limits, filter early), break large work into smaller steps, or use a different tool. Repeating the same command will hit the same timeout.`
          : `Tool execution failed with exception: ${errorMessage}`;

        // CRITICAL FIX: Save error tool_results to prevent orphaned tool_use blocks
        // When handleToolCalls throws an exception, we must still save tool_results
        // to maintain conversation integrity (tool_use must always be followed by tool_result)
        for (const toolUse of toolUseBlocks) {
          // Skip if this tool already has a result saved (prevents duplicate tool_result error)
          if (processedToolUseIds.has(toolUse.id)) {
            if (this.config.debug) {
              console.log(`[Orchestrator Streaming] Skipping error tool_result for ${toolUse.name} (${toolUse.id}) - already processed`);
            }
            continue;
          }

          // Emit error tool_result for CLI display
          yield {
            type: 'tool_result' as const,
            toolResult: {
              tool_use_id: toolUse.id,
              tool_name: toolUse.name,
              content: errorContent,
              is_error: true
            }
          };

          const toolResultMessageId = uuidv4();
          const toolResultMessage: Message = {
            uuid: toolResultMessageId,
            timestamp: new Date().toISOString(),
            type: 'user',
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: errorContent,
                is_error: true
              }]
            },
            timeline: {
              sessionId: this.currentSessionId,
              conversationId: this.currentConversationId,
              turnNumber: this.turnNumber + 1
            },
            model: {
              id: model.id,
              provider: model.provider,
              apiPattern: model.api.pattern
            }
          };

          // Record in timeline
          this.sessionTimeline.recordMessage(toolResultMessageId, 'user');

          // Add to history
          this.messageHistory.push(toolResultMessage);

          // Save to persistent storage
          await this.historyStore.appendMessage(this.currentSessionId, toolResultMessage);

          if (this.config.debug) {
            console.log(`[Orchestrator Streaming] Saved error tool_result for failed tool: ${toolUse.name} (${toolUse.id})`);
          }
        }

        if (toolError.name === 'AbortError') {
          console.error(`[Orchestrator Streaming] Tool execution aborted (timeout)`);
        } else {
          console.error(`[Orchestrator Streaming] Error in tool execution iteration ${toolCallIteration}:`, toolError.message);
        }

        // #21 (2026-05-11): bail on unrecoverable error shapes (mirrors
        // the non-streaming path; classifier is shared via apiErrorClassifier).
        const streamErrorCategory = classifyApiError(String(toolError.message || ''));
        if (streamErrorCategory !== 'recoverable') {
          console.error(`[Orchestrator Streaming] Fatal ${streamErrorCategory} API error, stopping loop:`, toolError.message);
          break;
        }

        totalToolErrors++;

        if (totalToolErrors >= MAX_CONSECUTIVE_ERRORS) {
          if (this.config.debug) {
            console.error(`[Orchestrator Streaming] Too many errors, stopping loop`);
          }
          break;
        }
      }
    }

    // Warn if hit max iterations
    if (toolCallIteration >= MAX_TOOL_ITERATIONS) {
      if (this.config.debug) {
        console.warn(`[Orchestrator Streaming] Max tool iterations (${MAX_TOOL_ITERATIONS}) reached. Stopping loop.`);
      }
    }

    // R29a (streaming parity): post-loop synthesis net. R32 added the R18b
    // in-loop retry above; this catches any remaining no-text exits (R18b
    // already fired, or a path that bypassed it). Tools suppressed — last resort.
    // Also fires on a short-preamble + unexecuted tool_use force-exit (see the
    // sendMessage path for the full rationale): a trailing tool_use post-loop
    // means the model was interrupted mid-action and never delivered an answer.
    if (shouldForceSynthesis(currentAssistantCanonicalMessage.content, emptyResponseRetryUsed)) {
      console.warn(
        `[Orchestrator Streaming] R29a: loop exited without a delivered answer ` +
        `(iteration=${toolCallIteration}). Forcing one tools-suppressed synthesis turn.`,
      );
      try {
        const synthUserMessage: Message = {
          uuid: uuidv4(),
          timestamp: new Date().toISOString(),
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'text',
              text: '<system-reminder>You stopped without giving a final answer. Provide your complete answer now in plain text — summarize your findings and deliver the requested result. Do NOT call any tools.</system-reminder>',
            }],
          },
          timeline: {
            sessionId: this.currentSessionId,
            conversationId: this.currentConversationId,
            turnNumber: this.turnNumber + 1,
          },
          model: {
            id: effectiveModel.id,
            provider: effectiveModel.provider,
            apiPattern: effectiveModel.api.pattern,
          },
        } as any;
        this.messageHistory.push(synthUserMessage);
        await this.historyStore.appendMessage(this.currentSessionId, synthUserMessage);

        await this.ensureHistoryFitsModel(effectiveModel);
        const synthCanonicalHistory = this.convertToCanonicalMessages([...this.messageHistory]);
        const synthRequest = this.gatewayTranslation.prepareRequest(
          synthCanonicalHistory,
          [], // tools suppressed — must produce text
          effectiveModel,
          {
            temperature: options.parameters?.temperature,
            maxTokens: options.parameters?.maxTokens,
            topP: options.parameters?.topP,
            reasoningEffort: options.parameters?.reasoningEffort,
            stream: false,
            staticSystemPrompt: this.currentStaticSystemPrompt, // R28
            conversationId: this.currentConversationId, // R28b
          },
        );
        if (this.lastResponseId && effectiveModel.api.pattern === 'responses') {
          synthRequest.previousResponseId = this.lastResponseId;
        }
        synthRequest.conversationId = this.currentSessionId;

        let synthApiResponse;
        if (this.retryMiddleware) {
          const synthResult = await this.retryMiddleware.executeWithRetry(
            () => this.apiClient.sendRequest(synthRequest, effectiveModel),
            'r29a_stream_synthesis_retry',
          );
          synthApiResponse = synthResult.result;
        } else {
          synthApiResponse = await this.apiClient.sendRequest(synthRequest, effectiveModel);
        }

        const synthConverted = this.gatewayTranslation.convertResponse(
          synthApiResponse.data,
          effectiveModel,
          {
            sessionId: this.currentSessionId,
            conversationId: this.currentConversationId,
            turnNumber: this.turnNumber + 1,
          },
        );
        if (effectiveModel.api.pattern === 'responses' && synthApiResponse.data?.id) {
          this.lastResponseId = synthApiResponse.data.id;
          this.lastResponseIdProvider = effectiveModel.provider; // R20a
        }

        if (synthConverted.messages && synthConverted.messages.length > 0) {
          const synthCanonical = synthConverted.messages[0]!;
          const synthText = (synthCanonical.content as any[])
            .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('');
          if (synthText.trim().length > 0) {
            yield { type: 'text_delta' as const, delta: synthText } as StreamChunk;
          }
          const synthAssistantMessage: Message = {
            uuid: synthCanonical.uuid,
            timestamp: synthCanonical.timestamp,
            type: 'assistant',
            message: { role: 'assistant', content: synthCanonical.content as any },
            timeline: {
              sessionId: this.currentSessionId,
              conversationId: this.currentConversationId,
              turnNumber: this.turnNumber + 1,
            },
            model: {
              id: effectiveModel.id,
              provider: effectiveModel.provider,
              apiPattern: effectiveModel.api.pattern,
            },
            ...(synthConverted.usage && { usage: synthConverted.usage }),
          } as any;
          this.messageHistory.push(synthAssistantMessage);
          await this.historyStore.appendMessage(this.currentSessionId, synthAssistantMessage);
          this.sessionTimeline.recordMessage(synthAssistantMessage.uuid, 'assistant');
          currentAssistantCanonicalMessage = synthCanonical;
          if (synthConverted.usage) {
            this.cacheMetricsAccumulator.addUsage(synthConverted.usage, effectiveModel.provider);
          }
        }
      } catch (synthErr: any) {
        console.warn(`[Orchestrator Streaming] R29a synthesis turn failed: ${synthErr?.message || synthErr}`);
      }
    }

    // Turn summary & prediction — yield as final streaming chunk
    if (process.env.TURN_SUMMARY_PREDICTION === 'true' && this.helperMiddleware) {
      try {
        const assistantText = Array.isArray(currentAssistantCanonicalMessage.content)
          ? (currentAssistantCanonicalMessage.content as any[])
              .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
              .map((b: any) => b.text)
              .join('')
          : String(currentAssistantCanonicalMessage.content ?? '');
        const toolNames = allExecutedToolUses.map((t: any) => t.name);
        const turnSummaryData = await this.helperMiddleware.generateTurnSummaryAndPrediction({
          lastAssistantText: assistantText,
          lastUserText: userContent,
          toolsUsed: toolNames,
        });
        if (turnSummaryData.summary || turnSummaryData.prediction) {
          yield {
            type: 'turn_summary' as const,
            data: { summary: turnSummaryData.summary, prediction: turnSummaryData.prediction },
          } as StreamChunk;
        }
      } catch (err: unknown) {
        if (this.config.debug) {
          console.warn('[Orchestrator Streaming] Turn summary generation failed:', (err as Error)?.message);
        }
      }
    }

    // Yield message_stop with usage data for CLI turn summary display
    const finalUsage = convertedResponse?.usage || { inputTokens: 0, outputTokens: 0 };
    yield {
      type: 'message_stop' as const,
      data: {
        usage: {
          inputTokens: finalUsage.inputTokens || 0,
          outputTokens: finalUsage.outputTokens || 0,
        },
        durationMs: Date.now() - turnStartMs,
        toolCallIterations: toolCallIteration,
      },
    } as StreamChunk;

    // Clean up ephemeral mentorship messages — they served their purpose during this turn
    this.cleanupEphemeralMessages();

    // Update turn number
    this.turnNumber += 2; // User + Assistant
  }

  // ============================================
  // PUBLIC API - MODEL MANAGEMENT (Phase 2.2.1)
  // ============================================

  /**
   * Switch to a different model mid-conversation (Phase 2.2.1)
   *
   * Workflow:
   * 1. Validate new model exists
   * 2. Load current conversation history
   * 3. Check if history fits in new model's context
   * 4. Apply selection strategy if needed
   * 5. Record model_switch event in timeline
   * 6. Update current model
   */
  async switchModel(
    newModelId: string,
    options: SwitchModelOptions = {}
  ): Promise<ModelSwitchResult> {
    if (!this.sessionTimeline) {
      throw new Error('Session not initialized. Call createSession() first.');
    }

    // Same-model no-op guard. The server route calls switchModel on every
    // request that carries `model`, so this fires on every headless turn even
    // when the model is unchanged. Falling through would null the Responses-API
    // chain (lastResponseId) and could slice history — silently breaking
    // multi-turn continuity. A genuine model change (different id) still falls
    // through to the reset/adjust logic below.
    if (newModelId === this.currentModelId) {
      return {
        success: true,
        previousModel: this.currentModelId,
        newModel: this.currentModelId,
        contextAdjustment: undefined,
        timelineEventId: ''
      };
    }

    // 1. Validate new model exists
    const newModel = this.getModel(newModelId);
    const previousModel = this.getModel(this.currentModelId);

    if (this.config.debug) {
      console.log(`[Orchestrator] Switching model: ${previousModel.id} → ${newModel.id}`);
    }

    // R28f: drop the pinned static system prompt for this conversation on a
    // genuine model switch. System messages are conditioned on apiPattern /
    // modelCapabilities, so the next turn must recompute a model-correct
    // baseline (which then re-pins and is byte-stable from that point on).
    if (this.currentConversationId) {
      this.staticSystemPromptByConversation.delete(this.currentConversationId);
    }

    // Reset Responses API chain on model switch — lastResponseId is namespaced
    // per-model on XAI's side, and cross-model chaining would return 404.
    if (this.lastResponseId) {
      if (this.config.debug) {
        console.log(`[Orchestrator] Resetting Responses API chain on model switch (was: ${this.lastResponseId})`);
      }
      this.lastResponseId = null;
      this.lastResponseIdProvider = null; // R20a
      this.messageCountAtLastResponse = 0;
    }

    // 2. Count current tokens
    const currentTokens = this.contextBudgetManager['estimateTotalTokens'](
      this.messageHistory
    );

    // 3. Check if history fits in new model's context
    const newModelBudget = this.contextBudgetManager.calculateBudget(newModel);
    const fitsInNewModel = currentTokens <= newModelBudget.availableForHistory;

    let contextAdjustment;

    if (!fitsInNewModel) {
      // 4. Apply selection strategy (Phase 2.2.4 will add compaction)
      const strategy = options.strategy || 'sliding-window';

      if (this.config.debug) {
        console.log(`[Orchestrator] Context too large (${currentTokens} > ${newModelBudget.availableForHistory})`);
        console.log(`[Orchestrator] Applying strategy: ${strategy}`);
      }

      // For now, just use sliding window (keep recent messages)
      const keepCount = Math.floor(this.messageHistory.length * 0.7); // Keep 70%
      const dropped = this.messageHistory.length - keepCount;
      this.messageHistory = this.messageHistory.slice(-keepCount);

      contextAdjustment = {
        strategy,
        messagesKept: keepCount,
        messagesDropped: dropped,
        compactionTriggered: false // Phase 2.2.4 will enable this
      };
    }

    // 5. Record model_switch event in timeline
    const switchEvent = this.sessionTimeline.recordModelSwitch(
      previousModel.id,
      newModel.id,
      options.reason
    );

    // 6. Update current model
    this.currentModelId = newModel.id;

    return {
      success: true,
      previousModel: previousModel.id,
      newModel: newModel.id,
      contextAdjustment,
      timelineEventId: switchEvent.id
    };
  }

  /**
   * Get current model configuration
   */
  getCurrentModel(): ModelConfig {
    return this.getModel(this.currentModelId);
  }

  /**
   * Get current model ID string
   */
  getCurrentModelId(): string {
    return this.currentModelId;
  }

  /**
   * List all available models
   */
  listAvailableModels(): ModelConfig[] {
    return this.modelRegistry.getAllModels();
  }

  /**
   * List all base tool definitions (canonical names, schemas, categories).
   * Surfaces the existing tools from the factory — does not create new ones.
   */
  getToolDefinitions(): ReturnType<typeof toolFactory.getAllTools> {
    return toolFactory.getAllTools();
  }

  /**
   * Normalize a tool name for whitelist matching: lowercase + strip non-
   * alphanumerics so PascalCase canonical names match the lower/snake_case
   * names used in agent definitions (e.g. `WebSearch` ≡ `web_search`).
   */
  private static normalizeToolName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Apply `config.allowedBaseTools` to the factory/base tool list. Returns the
   * list unchanged when no allowlist is configured. MCP/management/context
   * tools are filtered elsewhere — never here — so an allowlisted sub-agent
   * still receives its injected MCP tools on top of its base whitelist.
   */
  private applyBaseToolAllowlist<T extends { name: string }>(tools: T[]): T[] {
    const allow = this.config.allowedBaseTools;
    if (!allow || allow.length === 0) return tools;
    const allowed = new Set(allow.map((t) => CortexOrchestrator.normalizeToolName(t)));
    return tools.filter((t) => allowed.has(CortexOrchestrator.normalizeToolName(t.name)));
  }

  /**
   * Get adapter registry (for advanced use cases)
   */
  getAdapterRegistry(): AdapterRegistry {
    return this.adapterRegistry;
  }

  /**
   * Get resolved loop control configuration with unified defaults.
   * Single source of truth for both streaming and non-streaming paths.
   */
  getLoopControlConfig(): {
    maxToolIterations: number;
    maxConsecutiveErrors: number;
    toolBudgetSoft: number;
    toolTimeoutMs: number;
    maxLoopRepetitions: number;
  } {
    const softRaw = this.config.loopControl?.toolBudgetSoft;
    return {
      maxToolIterations: this.config.loopControl?.maxToolIterations ?? 50,
      maxConsecutiveErrors: this.config.loopControl?.maxConsecutiveErrors ?? 3,
      toolBudgetSoft: Number.isFinite(softRaw) && (softRaw as number) > 0 ? (softRaw as number) : 15,
      toolTimeoutMs: this.config.loopControl?.toolTimeoutMs ?? 120000,
      maxLoopRepetitions: this.config.loopControl?.maxLoopRepetitions ?? 5,
    };
  }

  getDiversityWarning(toolCallCounts: Map<string, number>): string | null {
    for (const [tool, count] of toolCallCounts) {
      if (count >= 10) {
        return `[${tool} called ${count} times. Consider synthesizing from gathered results instead of continuing to search.]`;
      }
    }
    return null;
  }


  isMutationTool(toolName: string): boolean {
    const mutationTools = new Set([
      'Write', 'Edit', 'NotebookEdit',
      'TodoCreate', 'TodoUpdate', 'TodoWrite',
      'Bash',
    ]);
    return mutationTools.has(toolName);
  }

  /**
   * Get historical context service (Phase 2.2.5)
   *
   * Advanced users can access historical tools directly
   */
  getHistoricalService(): HistoricalContextService {
    return this.historicalService;
  }

  // ============================================
  // PUBLIC API - SESSION MANAGEMENT (MVP)
  // ============================================

  /**
   * Create a new session (Phase 2.2.1 - with Timeline)
   */
  async createSession(
    projectPath: string,
    initialModelId?: string
  ): Promise<Session> {
    const sessionId = uuidv4();
    const modelId = initialModelId || this.config.defaultModelId;

    // Phase 2.2.1: Initialize SessionTimeline
    this.sessionTimeline = new SessionTimeline(sessionId, modelId);
    const conversationId = this.sessionTimeline.current.conversationId;

    // Phase 2.2.3: Set timeline reference for helper middleware
    this.helperMiddleware['timeline'] = this.sessionTimeline;

    // Phase 2: Initialize FileCheckpointManager with sessionId
    this.fileCheckpointManager = new FileCheckpointManager(
      this.config.storageDir!,
      sessionId
    );
    await this.fileCheckpointManager.initialize();

    // Phase 2.2.4: Initialize CheckpointManager with FileCheckpointManager integration
    this.checkpointManager = new CheckpointManager(
      this.sessionTimeline,
      this.historyStore,
      projectPath,
      this.fileCheckpointManager  // Phase 2: File tracking integration
    );

    // Initialize session state
    this.currentSessionId = sessionId;
    this.currentConversationId = conversationId;
    this.currentModelId = modelId;
    this.messageHistory = [];
    this.turnNumber = 0;

    // Round 6 (Opus self-audit finding): canonicalConversionCache must be
    // cleared on session reset so stale entries (including synthetic-repair
    // uuids from the previous session) can't leak into the new session.
    this.canonicalConversionCache.clear();

    // Reset XAI Responses API chain for new session (was leaking across `--new`).
    // Without this, a new session would reuse lastResponseId from the previous
    // session, sending previous_response_id that the server doesn't recognize
    // OR sending sliced history that doesn't include the new session's context.
    this.lastResponseId = null;
    this.lastResponseIdProvider = null; // R20a
    this.messageCountAtLastResponse = 0;

    // Phase 2.7: Reset cache metrics for new session
    this.cacheMetricsAccumulator.reset();

    // Store project path in config
    this.config.projectPath = projectPath;

    // Update executor registry with session context for historical tools
    this.executorRegistry.updateConfig({
      sessionId,
      storageDir: this.config.storageDir,
      workspaceRoot: projectPath
    });

    // Phase 2.5 Day 4.5: MCP Config-Based Auto-Injection Discovery
    if (this.mcpManager) {
      await this.initializeMcpFromConfig();
    }

    // Note: JSONLHistoryStore will create the session file on first appendMessage call

    if (this.config.debug) {
      console.log('[Orchestrator Phase 2.2.1] Created session:', sessionId);
      console.log('[Orchestrator Phase 2.2.1] Timeline initialized with conversation:', conversationId);
    }

    return {
      sessionId,
      conversationId,
      modelId,
      projectPath,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      messageCount: 0
    };
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.currentSessionId;
  }

  /**
   * Get current conversation ID
   */
  getConversationId(): string {
    return this.currentConversationId;
  }

  /**
   * Get message history
   */
  getMessageHistory(): Message[] {
    // DEBUG: Log tool_result messages with their metadata
    if (this.config.debug) {
      const toolResultMsgs = this.messageHistory.filter(m =>
        m.type === 'user' &&
        Array.isArray((m as any).message?.content) &&
        (m as any).message.content.some((b: any) => b.type === 'tool_result')
      );
      if (process.env.DEBUG === 'true') console.log(`[Orchestrator DEBUG getMessageHistory] Found ${toolResultMsgs.length} tool_result messages`);
      toolResultMsgs.forEach((msg: any, idx) => {
        const content = msg.message?.content || [];
        content.filter((b: any) => b.type === 'tool_result').forEach((tr: any) => {
          console.log(` [${idx}] tool_name: ${tr.tool_name}, has_metadata: ${!!tr.metadata}, has_diff: ${!!tr.metadata?.diff}`);
        });
      });
    }
    return [...this.messageHistory];
  }

  /**
   * Resume an existing session by loading its full history
   *
   * @param sessionId - Session ID to resume
   * @param projectPath - Project path for the session
   */
  async resumeSession(
    sessionId: string,
    projectPath: string
  ): Promise<Session> {
    // Load messages from history store
    const messages = await this.historyStore.loadSession(sessionId);

    if (messages.length === 0) {
      throw new Error(`Session ${sessionId} not found or has no messages`);
    }

    // Get session info to confirm existence
    const sessionInfo = await this.historyStore.getSessionInfo(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Load persisted metadata (currentModel, cacheMetrics, responsesApiChain).
    // getSessionInfo() synthesises metadata from file stats only — it does not
    // read the .meta.json file — so it never has currentModel populated. We need
    // loadMetadata for chain-model-match on resume; otherwise modelMatches always
    // fails and the previous_response_id chain is silently discarded.
    const persistedMetadata = await this.historyStore.loadMetadata(sessionId, projectPath);

    // Prefer persisted currentModel, then last assistant message's model.id,
    // then orchestrator default. This order means the session's prior effective
    // model wins over the .env default, which is the user's expectation on resume.
    let modelId = persistedMetadata?.currentModel || this.config.defaultModelId;
    if (!persistedMetadata?.currentModel) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as any;
        if (m?.type === 'assistant' && m?.model?.id) {
          modelId = m.model.id;
          break;
        }
      }
    }

    // Initialize SessionTimeline with existing sessionId
    this.sessionTimeline = new SessionTimeline(sessionId, modelId);
    const conversationId = this.sessionTimeline.current.conversationId;

    // Set timeline reference for helper middleware
    this.helperMiddleware['timeline'] = this.sessionTimeline;

    // Initialize FileCheckpointManager
    this.fileCheckpointManager = new FileCheckpointManager(
      this.config.storageDir!,
      sessionId
    );
    await this.fileCheckpointManager.initialize();

    // Initialize CheckpointManager
    this.checkpointManager = new CheckpointManager(
      this.sessionTimeline,
      this.historyStore,
      projectPath,
      this.fileCheckpointManager
    );

    // Set session state
    this.currentSessionId = sessionId;
    this.currentConversationId = conversationId;
    this.currentModelId = modelId;
    this.messageHistory = messages;
    // Messages have nested structure: m.message.role
    this.turnNumber = messages.filter((m: any) => (m.message || m).role === 'user').length;

    // Round 6: clear canonical-conversion cache on session resume too —
    // entries from a previously running orchestrator instance are stale.
    this.canonicalConversionCache.clear();

    // Reuse the persistedMetadata loaded above — avoid a second disk read.
    const savedMetadata = persistedMetadata;
    if (savedMetadata?.cacheMetrics) {
      this.cacheMetricsAccumulator.fromJSON(savedMetadata.cacheMetrics);
      if (this.config.debug) {
        console.log('[Orchestrator] Restored cache metrics from session:', {
          requestCount: savedMetadata.cacheMetrics.requestCount,
          hitRate: (savedMetadata.cacheMetrics.overallCacheHitRate * 100).toFixed(1) + '%'
        });
      }
    } else {
      // No saved metrics, start fresh
      this.cacheMetricsAccumulator.reset();
    }

    // Restore Responses API chain state if present and still valid:
    // - same model as the resumed session (chain is model-namespaced)
    // - timestamp within 30-day TTL (XAI expires stored responses after 30d)
    // - messageCountAtLastResponse <= current history length (history must extend it)
    if (savedMetadata?.responsesApiChain) {
      const chain = savedMetadata.responsesApiChain;
      const chainAgeMs = Date.now() - new Date(chain.timestamp).getTime();
      const chainAgeDays = chainAgeMs / (1000 * 60 * 60 * 24);
      const modelMatches = chain.modelId === modelId;
      const indexValid = chain.messageCountAtLastResponse <= this.messageHistory.length;
      const withinTTL = chainAgeDays < 30; // XAI 30-day retention

      if (modelMatches && indexValid && withinTTL) {
        this.lastResponseId = chain.lastResponseId;
        this.lastResponseIdProvider = (chain as any).lastResponseIdProvider ?? null; // R20a
        this.messageCountAtLastResponse = chain.messageCountAtLastResponse;
        if (this.config.debug) {
          console.log('[Orchestrator] Restored Responses API chain:', {
            lastResponseId: chain.lastResponseId,
            chainAgeDays: chainAgeDays.toFixed(2),
            messageCountAtLastResponse: chain.messageCountAtLastResponse
          });
        }
      } else if (this.config.debug) {
        console.log('[Orchestrator] Responses API chain invalid on resume:', {
          modelMatches,
          indexValid,
          withinTTL,
          chainAgeDays: chainAgeDays.toFixed(2)
        });
      }
    }

    // Store project path
    this.config.projectPath = projectPath;

    // Update executor registry
    this.executorRegistry.updateConfig({
      sessionId,
      storageDir: this.config.storageDir,
      workspaceRoot: projectPath
    });

    // Initialize MCP if available
    if (this.mcpManager) {
      await this.initializeMcpFromConfig();
    }

    // Replay messages into timeline to rebuild state
    for (const message of messages) {
      const msg = message as any;
      const messageId = msg.uuid || msg.id;
      // Messages from JSONL have nested structure: msg.message.role
      const actualMsg = msg.message || msg;
      const role = actualMsg.role;

      if (messageId && role) {
        this.sessionTimeline.recordMessage(messageId, role);
      }
    }

    if (this.config.debug) {
      console.log('[Orchestrator] Resumed session:', sessionId);
      console.log('[Orchestrator] Loaded', messages.length, 'messages');
      console.log('[Orchestrator] Model:', modelId);
    }

    return {
      sessionId,
      conversationId,
      modelId,
      projectPath,
      createdAt: sessionInfo.metadata.startTime,
      lastActivityAt: sessionInfo.lastModified.toISOString(),
      messageCount: messages.length
    };
  }

  // ============================================
  // PUBLIC API - CHECKPOINT MANAGEMENT (Phase 2.2.4)
  // ============================================

  /**
   * Create a checkpoint at the current conversation position
   *
   * Phase 2.2.4: User-created checkpoints with resume capability
   *
   * @param options - Checkpoint options (description, file states, metadata)
   * @returns Created checkpoint
   */
  async createCheckpoint(options: CheckpointOptions = {}): Promise<Checkpoint> {
    if (!this.checkpointManager) {
      throw new Error('Session not initialized. Call createSession() first.');
    }

    const checkpoint = await this.checkpointManager.createCheckpoint(options);

    if (this.config.debug) {
      console.log(`[Orchestrator Phase 2.2.4] Created checkpoint: ${checkpoint.id}`);
      console.log(` Turn: ${checkpoint.turnNumber}, Messages: ${checkpoint.snapshot.messageIds.length}`);
    }

    return checkpoint;
  }

  /**
   * Resume from a checkpoint (creates new conversation branch)
   *
   * Phase 2.2.4: Cross-provider resume and conversation branching
   *
   * @param checkpointId - ID of checkpoint to resume from
   * @param options - Resume options (model ID, preserve history)
   * @returns Resume result with new conversation and messages
   */
  async resumeFromCheckpoint(
    checkpointId: string,
    options: ResumeOptions = {}
  ): Promise<{ conversationId: string; messageCount: number; model: string }> {
    if (!this.checkpointManager) {
      throw new Error('Session not initialized. Call createSession() first.');
    }

    const result = await this.checkpointManager.resumeFromCheckpoint(checkpointId, options);

    // Update orchestrator state with resumed conversation
    this.currentConversationId = result.conversation.id;
    this.messageHistory = result.messages;
    this.turnNumber = result.checkpoint.turnNumber;

    // Update current model if specified
    if (options.modelId) {
      this.currentModelId = options.modelId;
    } else {
      this.currentModelId = result.checkpoint.snapshot.modelId;
    }

    if (this.config.debug) {
      console.log(`[Orchestrator Phase 2.2.4] Resumed from checkpoint: ${checkpointId}`);
      console.log(` New conversation: ${result.conversation.id}`);
      console.log(` Messages loaded: ${result.messages.length}`);
      console.log(` Model: ${this.currentModelId}`);
    }

    return {
      conversationId: result.conversation.id,
      messageCount: result.messages.length,
      model: this.currentModelId
    };
  }

  /**
   * List all checkpoints for current session
   *
   * Phase 2.2.4: Checkpoint browsing
   */
  listCheckpoints(): Checkpoint[] {
    if (!this.sessionTimeline) {
      return [];
    }

    return this.sessionTimeline.getAllCheckpoints();
  }

  /**
   * Get a specific checkpoint by ID
   *
   * Phase 2.2.4: Checkpoint retrieval
   */
  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    if (!this.sessionTimeline) {
      return undefined;
    }

    return this.sessionTimeline.getCheckpoint(checkpointId);
  }

  // ============================================
  // PUBLIC API - MCP MANAGEMENT (Phase 2.9)
  // ============================================

  /**
   * Get MCP client manager
   *
   * Phase 2.9: Access to MCP functionality
   * Consumers (like tool executors) can use this to access MCP servers
   */
  getMcpManager(): McpClientManager | undefined {
    return this.mcpManager;
  }

  /**
   * Check if MCP is enabled
   *
   * Phase 2.9: MCP status check
   */
  isMcpEnabled(): boolean {
    return !!this.mcpManager;
  }

  /**
   * Get MCP server info
   *
   * Phase 2.9: MCP server status
   */
  getMcpServerInfo(): Array<{
    name: string;
    status: string;
    toolCount: number;
    resourceCount: number;
  }> {
    if (!this.mcpManager) {
      return [];
    }

    return this.mcpManager.getServerInfo().map(info => ({
      name: info.name,
      status: info.status,
      toolCount: info.toolCount,
      resourceCount: info.resourceCount,
    }));
  }

  /**
   * Get discovered MCP tool declarations
   *
   * Returns all tools discovered from MCP servers with their metadata.
   * Consumers should wrap these in DiscoveredMcpToolExecutor instances
   * and register them with the ToolRegistry.
   *
   * Phase 2.9: Dynamic MCP tool registration
   */
  getMcpToolDeclarations(): Array<{
    serverName: string;
    toolName: string;
    description: string;
    inputSchema: any;
  }> {
    if (!this.mcpManager) {
      return [];
    }

    const allTools = this.mcpManager.getAllTools();

    return allTools.map(tool => ({
      serverName: tool.serverName,
      toolName: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    }));
  }

  // ============================================
  // PUBLIC API - CLEANUP (Phase 2.9)
  // ============================================

  /**
   * Cleanup orchestrator resources
   *
   * Phase 2.9: Proper cleanup including MCP connections
   * Should be called when shutting down or destroying the orchestrator
   */
  async cleanup(): Promise<void> {
    if (this.config.debug) {
      console.log('[Orchestrator] Cleaning up resources...');
    }

    // Phase 2.9: Cleanup MCP connections
    if (this.mcpManager) {
      try {
        await this.mcpManager.cleanup();
        if (this.config.debug) {
          console.log('[Orchestrator Phase 2.9] MCP connections closed');
        }
      } catch (error: any) {
        console.error('[Orchestrator Phase 2.9] Error cleaning up MCP:', error.message);
      }
    }

    if (this.config.debug) {
      console.log('[Orchestrator] Cleanup complete');
    }
  }

  // ============================================
  // PUBLIC API - MCP CONFIG MANAGEMENT (Phase 2.5 Day 4.5)
  // ============================================

  /**
   * Get MCP config manager (for model tools to use)
   */
  getMcpConfigManager(): McpConfigManager {
    return this.mcpConfigManager;
  }

  /**
   * Get MCP server registry (for model tools to use)
   */
  getMcpServerRegistry(): McpServerRegistry {
    return this.mcpRegistry;
  }

  /**
   * Check if MCP auto-injection is enabled
   */
  isMcpAutoInjectEnabled(): boolean {
    return this.mcpAutoInject;
  }

  /**
   * Get MCP tools as CanonicalTools (public getter)
   */
  getMcpTools(): any[] {
    return this.getMcpToolsAsCanonical();
  }

  // ============================================
  // PUBLIC API - CACHE METRICS (Phase 2.7)
  // ============================================

  /**
   * Get cache performance metrics for current session
   *
   * @returns Session cache metrics including hit rate and cost savings
   */
  getCacheMetrics() {
    return this.cacheMetricsAccumulator.getMetrics();
  }

  /**
   * Get formatted cache performance report
   *
   * @returns Human-readable text report of cache performance
   */
  getCacheReport(): string {
    return this.cacheMetricsAccumulator.formatReport();
  }

  /**
   * Reset cache metrics (useful when starting new session)
   */
  resetCacheMetrics(): void {
    this.cacheMetricsAccumulator.reset();
  }

  /**
   * Persist cache metrics to session metadata file
   * Called after each API request to preserve metrics across restarts.
   *
   * @param effectiveModelId The model that actually produced the response (may differ
   *   from this.currentModelId when the caller passed options.modelId to override for
   *   a single request). The chain modelId must match the model that generated
   *   lastResponseId — otherwise chain-break-on-model-switch logic reads the wrong id
   *   on resume. Falls back to this.currentModelId when not provided (legacy callers).
   */
  private async persistCacheMetrics(effectiveModelId?: string): Promise<void> {
    if (!this.currentSessionId) return;

    const metrics = this.cacheMetricsAccumulator.toJSON();
    const recordedModelId = effectiveModelId || this.currentModelId;
    const metadataUpdate: any = {
      cacheMetrics: metrics,
      currentModel: recordedModelId,
      // Explicitly set responsesApiChain (null when reset) so saveMetadata's merge
      // doesn't leave stale chain state from prior requests/turns.
      responsesApiChain: this.lastResponseId
        ? {
            lastResponseId: this.lastResponseId,
            messageCountAtLastResponse: this.messageCountAtLastResponse,
            modelId: recordedModelId,
            timestamp: new Date().toISOString()
          }
        : null
    };

    await this.historyStore.saveMetadata(
      this.currentSessionId,
      metadataUpdate,
      this.config.projectPath
    );
  }

  // ============================================
  // PRIVATE METHODS - SYSTEM MESSAGE INJECTION (Phase 2)
  // ============================================
  // NOTE: System message injection is now handled by SystemMessageMiddleware
  // Methods buildInjectionContext(), buildTemplateVariables(), and injectSystemMessages()
  // have been removed in favor of middleware delegation (see line 479-503)

  // ============================================
  // PRIVATE METHODS - PROACTIVE CONTEXT MANAGEMENT (Phase 1)
  // ============================================

  /**
   * Ensure message history fits within model's context window
   *
   * Proactively manages context size BEFORE sending API requests to prevent
   * exponential growth and context limit errors. Uses the canonical history
   * architecture's built-in compaction infrastructure.
   *
   * Design principle: compaction first, windowing last. The system exhausts
   * helper-model compaction before falling back to sliding-window truncation
   * of oldest messages. Retained content leverages prompt caching to minimize
   * re-processing costs.
   *
   * Phase 1: Core Protection
   * - Monitors token count before each API request
   * - Triggers compaction when approaching context limits
   * - Uses ContextBudgetManager for message selection
   * - Preserves critical messages (tool calls, recent context)
   */
  private async ensureHistoryFitsModel(model: ModelConfig): Promise<void> {
    // Skip if compaction disabled in config
    if (!this.config.autoCompact) {
      return;
    }

    // Skip if model has compaction disabled
    if (model.compaction.strategy === 'off') {
      return;
    }

    // Thinking blocks are NEVER stripped — stripping mutates messageHistory,
    // breaks prompt-cache prefix continuity, and causes model confusion.
    // Context overflow is handled by compaction (whole-message removal).
    const currentTokens: number = (this.contextBudgetManager as any).estimateTotalTokens(this.messageHistory);

    // Budget overrides: use actual token counts instead of hardcoded estimates.
    // - actualToolTokens: real tool schema size (tools are NOT in messageHistory)
    // - actualSystemTokens: 0 because system messages are embedded as <system-reminder>
    //   tags in user message content, already counted by estimateTotalTokens(messageHistory)
    const budgetOverrides = {
      actualToolTokens: this.currentToolTokens,
      actualSystemTokens: 0
    };

    // Calculate compaction threshold using model's configuration (with accurate overrides)
    const threshold = this.contextBudgetManager.getCompactionThreshold(model, budgetOverrides);

    if (this.config.debug) {
      console.log(`[Orchestrator Context] Current tokens: ${currentTokens}, Threshold: ${threshold} (tool reserve: ${this.currentToolTokens})`);
    }

    // Check if compaction needed
    if (currentTokens < threshold) {
      return; // Within limits, no action needed
    }

    if (this.config.debug) {
      console.log(`⚠  Context size (${currentTokens} tokens) exceeds threshold (${threshold}) - managing context...`);
    }

    try {
      // Calculate available budget for history (with accurate overrides)
      const budget = this.contextBudgetManager.calculateBudget(model, budgetOverrides);

      // Determine selection strategy based on model configuration
      const strategy = model.compaction?.behavior?.compactOlder ? 'preserve-critical' : 'sliding-window';

      // Select messages that fit within budget (standard path — no thinking stripping)
      const selectedMessages = this.contextBudgetManager.selectMessages(
        this.messageHistory,
        budget.availableForHistory,
        { strategy, preserveToolCalls: true },
        model
      );

      const removedCount = this.messageHistory.length - selectedMessages.length;
      const newTokenCount = (this.contextBudgetManager as any).estimateTotalTokens(selectedMessages);

      if (this.config.debug) {
        console.log(`[OK] Context managed: ${this.messageHistory.length} -> ${selectedMessages.length} messages`);
        console.log(` Token reduction: ${currentTokens} -> ${newTokenCount} tokens (removed ${currentTokens - newTokenCount})`);
        console.log(` Strategy: ${strategy}, Removed: ${removedCount} messages`);
      }

      // Update message history with selected messages
      this.messageHistory = selectedMessages;

      // TODO Phase 2: Record compaction event in timeline
      // TODO Phase 2: Save compaction summary to StoredCompactionManager
      // TODO Phase 2: Update JSONL history with compaction marker

    } catch (error: any) {
      console.error(`[Orchestrator Context] Context management failed:`, error.message);
      // Don't throw - let the request proceed
      // Reactive compaction in HelperModelMiddleware will catch API errors
    }
  }

  /**
   * Process tool result to handle large outputs intelligently
   *
   * Two-tier strategy:
   * 1. First large output: Reject with guidance (encourages better approach)
   * 2. Subsequent or unavoidable: Truncate and continue
   *
   * This guides the model to use more targeted commands while providing
   * fallback protection for cases where truncation is necessary.
   */
  private processToolResult(
    toolName: string,
    toolOutput: string
  ): { content: string; isError: boolean } {
    // Estimate token count (rough: ~4 chars per token)
    const estimatedTokens = Math.ceil(toolOutput.length / 4);
    const MAX_TOOL_OUTPUT_TOKENS = 20000; // 20K token limit per tool result

    // Normal case: output fits comfortably
    if (estimatedTokens <= MAX_TOOL_OUTPUT_TOKENS) {
      return { content: toolOutput, isError: false };
    }

    // Large output detected
    if (this.config.debug) {
      console.log(
        `⚠  [Orchestrator] Tool "${toolName}" output is large ` +
        `(~${estimatedTokens.toLocaleString()} tokens, limit ${MAX_TOOL_OUTPUT_TOKENS.toLocaleString()})`
      );
    }

    // Strategy: Return as error with guidance and preview
    // This gives the model a chance to try a more targeted approach
    const truncated = this.truncateToolOutput(toolOutput, MAX_TOOL_OUTPUT_TOKENS);

    const toolLower = toolName.toLowerCase();
    let toolSpecificHint = '';
    if (toolLower === 'read' || toolLower === 'readfile') {
      toolSpecificHint = `This file is too large to read ${MAX_TOOL_OUTPUT_TOKENS.toLocaleString()} tokens at once. ` +
        `Re-read with limit: 500 (or smaller) and use offset to navigate to the section you need.\n\n`;
    }

    const guidanceMessage =
      `Tool result too large (~${estimatedTokens.toLocaleString()} tokens, limit ${MAX_TOOL_OUTPUT_TOKENS.toLocaleString()}).\n\n` +
      toolSpecificHint +
      `Please try a more targeted approach:\n` +
      `• For read: Use limit: 500 (or smaller) with offset to read manageable chunks\n` +
      `• For grep/rg: Add --max-count=100 or search specific paths\n` +
      `• For find: Use -maxdepth N to limit recursion\n` +
      `• For ls: Target specific directories instead of -R\n` +
      `• For bash: Pipe to 'head -n 100' or use more specific filters\n\n` +
      `Preview of truncated output (first/last portions shown):\n` +
      `${'='.repeat(70)}\n${truncated}\n${'='.repeat(70)}\n\n` +
      `If you cannot be more specific, acknowledge this and request the truncated output, ` +
      `or adjust your analysis to work with the preview shown above.`;

    return {
      content: guidanceMessage,
      isError: true // Marks as error so model can retry with better approach
    };
  }

  /**
   * Smart truncation for tool outputs
   * Keeps first 60% and last 40% with clear truncation marker
   */
  private truncateToolOutput(output: string, maxTokens: number): string {
    const lines = output.split('\n');
    const estimatedLinesPerToken = 0.1; // ~10 tokens per line average
    const maxLines = Math.floor(maxTokens * estimatedLinesPerToken);

    if (lines.length <= maxLines) {
      return output; // Shouldn't happen, but safety check
    }

    // Keep first 60% and last 40%
    const keepStart = Math.floor(maxLines * 0.6);
    const keepEnd = Math.floor(maxLines * 0.4);
    const truncatedCount = lines.length - (keepStart + keepEnd);

    return [
      ...lines.slice(0, keepStart),
      '',
      `... [${truncatedCount.toLocaleString()} lines truncated] ...`,
      '',
      ...lines.slice(-keepEnd)
    ].join('\n');
  }

  // ============================================
  // PRIVATE METHODS - MCP INITIALIZATION (Phase 2.5 Day 4.5)
  // ============================================

  /**
   * Initialize MCP from MCP_CONFIG.md discovery
   *
   * Phase 2.5 Day 4.5: Config-based opt-in auto-injection
   */
  private async initializeMcpFromConfig(): Promise<void> {
    if (!this.mcpManager) {
      return;
    }

    try {
      // 1. Check for project-level MCP_CONFIG.md
      const projectConfigExists = await this.mcpConfigManager.configExists('project');
      const projectConfig = projectConfigExists
        ? await this.mcpConfigManager.readConfig('project')
        : null;

      // 2. Check for global MCP_CONFIG.md
      const globalConfigExists = await this.mcpConfigManager.configExists('global');
      const globalConfig = globalConfigExists
        ? await this.mcpConfigManager.readConfig('global')
        : null;

      // 3. Merge configs (project overrides global)
      const mergedConfig = this.mcpConfigManager.mergeConfigs(projectConfig, globalConfig);

      if (!mergedConfig) {
        // No config found - auto-injection disabled
        this.mcpAutoInject = false;
        if (this.config.debug) {
          console.log('[Orchestrator Phase 2.5] No MCP_CONFIG.md found - auto-injection disabled');
        }
        return;
      }

      if (this.config.debug) {
        const configSource = projectConfigExists ? 'project' : 'global';
        console.log(`[Orchestrator Phase 2.5] Found MCP_CONFIG.md (${configSource}) with ${mergedConfig.servers.length} server(s)`);
      }

      // 4. Get auto-start servers
      const autoStartServers = this.mcpConfigManager.getAutoStartServers(mergedConfig);

      if (autoStartServers.length === 0) {
        if (this.config.debug) {
          console.log('[Orchestrator Phase 2.5] No auto-start servers configured');
        }
        this.mcpAutoInject = false;
        return;
      }

      // 5. Connect to auto-start servers
      if (this.config.debug) {
        console.log(`[Orchestrator Phase 2.5] Connecting to ${autoStartServers.length} auto-start server(s)...`);
      }

      for (const serverEntry of autoStartServers) {
        try {
          const serverConfig = this.mcpConfigManager.toServerConfig(serverEntry);
          this.mcpManager.addServerConfig(serverEntry.name, serverConfig);
          await this.mcpManager.connectToServer(serverEntry.name);

          if (this.config.debug) {
            console.log(`[Orchestrator Phase 2.5] Connected to MCP server: ${serverEntry.name}`);
          }
        } catch (error: any) {
          console.error(`[Orchestrator Phase 2.5] Failed to connect to ${serverEntry.name}:`, error.message);
          // Continue with other servers
        }
      }

      // 6. Discover tools from connected servers
      await this.mcpManager.discoverAll();

      const serverInfo = this.mcpManager.getServerInfo();
      const connectedCount = serverInfo.filter(s => s.status === 'connected').length;
      const totalTools = serverInfo.reduce((sum, info) => sum + info.toolCount, 0);

      if (this.config.debug) {
        console.log(`[Orchestrator Phase 2.5] MCP discovery complete: ${connectedCount} server(s), ${totalTools} tool(s)`);
      }

      // 7. Enable auto-injection only if (a) at least one server connected AND
      // (b) the operator hasn't opted out via MCP_AUTO_INJECT=false. The env
      // var must gate INJECTION, not just config LOAD — otherwise nexus-browser's
      // 43 tools (~12.5K input tokens) ride along on every request even when
      // the operator has explicitly disabled blanket auto-injection.
      const autoInjectEnv = process.env.MCP_AUTO_INJECT;
      this.mcpAutoInject = shouldAutoInjectMcp(connectedCount, autoInjectEnv);
      if (this.mcpAutoInject) {
        if (this.config.debug) {
          console.log('[Orchestrator Phase 2.5] MCP auto-injection enabled');
        }
      } else if (connectedCount > 0) {
        if (this.config.debug) {
          console.log('[Orchestrator Phase 2.5] MCP servers connected but auto-injection disabled by MCP_AUTO_INJECT=false (use management tools to invoke)');
        }
      } else {
        console.warn('[Orchestrator Phase 2.5] No MCP servers connected - auto-injection disabled');
      }

    } catch (error: any) {
      console.error('[Orchestrator Phase 2.5] MCP initialization error:', error.message);
      this.mcpAutoInject = false;
      // Don't fail session creation if MCP initialization fails
    }
  }

  // ============================================
  // PRIVATE METHODS - TOOL EXECUTION (Phase 2.5)
  // ============================================

  /**
   * Handle tool calls by executing them through ExecutorRegistry
   *
   * Phase 2.5: Tool execution integration
   *
   * @param toolUseBlocks Array of tool_use content blocks from model response
   * @param signal AbortSignal for cancellation
   * @returns Array of tool results
   */
  private async handleToolCalls(
    toolUseBlocks: Array<{ id: string; name: string; input: any }>,
    signal: AbortSignal
  ): Promise<Array<{ tool_use_id: string; tool_name: string; content: string; is_error?: boolean; metadata?: any }>> {
    const results: Array<{ tool_use_id: string; tool_name: string; content: string; is_error?: boolean; metadata?: any }> = [];

    if (this.config.debug) {
      console.log(`[Orchestrator Phase 2.5] Executing ${toolUseBlocks.length} tool call(s)`);
    }

    // Separate Task tools from other tools for parallel execution
    const taskTools = toolUseBlocks.filter(t => t.name === 'Task');
    const otherTools = toolUseBlocks.filter(t => t.name !== 'Task');

    if (this.config.debug && taskTools.length > 0) {
      console.log(`[Orchestrator] Task tools in this batch: ${taskTools.length} (need >1 for parallel execution)`);
    }

    // Execute Task tools in parallel if there are multiple
    if (taskTools.length > 1) {
      if (this.config.debug) {
        console.log(`[Orchestrator] Executing ${taskTools.length} Task tools in PARALLEL`);
      }

      // Inject team briefing into each Task tool's prompt
      const enrichedTaskTools = this.injectTeamBriefing(taskTools);

      // Execute all Task tools concurrently with early-completion broadcasting.
      // When an agent completes, its summary is forwarded to still-running siblings
      // via the guidance IPC channel.
      const taskPromises = enrichedTaskTools.map(toolUse => {
        const promise = this.executeSingleToolCallWithTraining(toolUse, signal);
        // When this agent completes, broadcast its summary to siblings
        promise.then(result => {
          if (!result.is_error && this.subAgentProcessManager) {
            const agentName = result.metadata?.subAgentResult?.agentName || toolUse.input?.subagent_type || 'agent';
            const summary = `Agent "${agentName}" completed: ${(result.content || '').substring(0, 500)}`;
            this.subAgentProcessManager.broadcastGuidance(
              ` Team Update: ${summary}`,
              result.metadata?.subAgentResult?.agentId,
            );
          }
        }).catch(() => { /* Error handling is in executeSingleToolCall */ });
        return promise;
      });

      const taskResults = await Promise.allSettled(taskPromises);
      for (const settled of taskResults) {
        if (settled.status === 'fulfilled') {
          results.push(settled.value);
        } else {
          // Create an error result for rejected promises
          results.push({
            tool_use_id: 'unknown',
            tool_name: 'Task',
            content: `Sub-agent failed: ${settled.reason?.message || 'Unknown error'}`,
            is_error: true,
          });
        }
      }

      // Then execute other tools sequentially
      for (const toolUse of otherTools) {
        const result = await this.executeSingleToolCallWithTraining(toolUse, signal);
        results.push(result);
      }

      return results;
    }

    // Default: Execute all tools sequentially (original behavior)
    for (const toolUse of toolUseBlocks) {
      try {
        if (this.config.debug) {
          console.log(`[Orchestrator Phase 2.5] Executing tool: ${toolUse.name}`);
        }

        // Context management tools (CORTEX.md generation)
        const contextManagementToolNames = [
          'InitCortexContext'
        ];
        const isContextManagementTool = contextManagementToolNames.includes(toolUse.name);

        // Phase 2.6: Check if this is an MCP management tool
        const mcpManagementToolNames = [
          'ListAvailableMcpServers',
          'SearchMcpServers',
          'GetMcpConfig',
          'EnableMcpServer',
          'DisableMcpServer',
          'ConfigureMcpServer',
          'InitMcpConfig'
        ];
        const isMcpManagementTool = mcpManagementToolNames.includes(toolUse.name);

        // Phase 2.5 Day 4: Check if this is an MCP tool
        const mcpServerName = this.getMcpServerForTool(toolUse.name);
        const isMcpTool = mcpServerName !== undefined;

        // Check if tool exists (context management, MCP management, MCP, or executor)
        if (!isContextManagementTool && !isMcpManagementTool && !isMcpTool && !this.executorRegistry.hasExecutor(toolUse.name)) {
          const availableExecutors = this.executorRegistry.getExecutorNames();
          const availableMcpTools = this.mcpManager ? this.mcpManager.getAllTools().map(t => t.name) : [];
          const allAvailable = [...availableExecutors, ...availableMcpTools, ...contextManagementToolNames, ...mcpManagementToolNames];

          // #17 — nudge typo recovery. Round-10 caught cortex/gemini-2.5-pro
          // calling `Gorp` (typo of `Grep`) and stalling on the bare
          // "Unknown tool" reply. Surface up to 3 closest matches first so
          // the model can self-correct on the next iteration.
          const suggestions = closestToolMatches(toolUse.name, allAvailable, 3);
          const suggestionPart = suggestions.length > 0
            ? ` Did you mean: ${suggestions.join(', ')}?`
            : '';
          const errorMessage = `Unknown tool: ${toolUse.name}.${suggestionPart} Available tools: ${allAvailable.join(', ')}`;
          console.error(`[Orchestrator Phase 2.5] ${errorMessage}`);

          results.push({
            tool_use_id: toolUse.id,
            tool_name: toolUse.name,
            content: errorMessage,
            is_error: true
          });
          continue;
        }

        // Phase 2.5 Day 3: Execute tool with retry logic for transient failures
        const MAX_RETRIES = 2;
        const BASE_DELAY_MS = 1000;
        let result: any;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 0) {
              // Exponential backoff for retries
              const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
              if (this.config.debug) {
                console.log(`[Orchestrator Phase 2.5] Retrying ${toolUse.name} (attempt ${attempt + 1}/${MAX_RETRIES + 1}) after ${delay}ms`);
              }
              await new Promise(resolve => setTimeout(resolve, delay));

              // Check if aborted during delay
              if (signal.aborted) {
                throw new Error('Aborted during retry delay');
              }
            }

            const startTime = Date.now();

            // Execute Context Management tools
            if (isContextManagementTool) {
              if (this.config.debug) {
                console.log(`[Orchestrator] Executing context management tool: ${toolUse.name}`);
              }

              let contextManagementResult: any;

              // Execute the appropriate context management tool
              switch (toolUse.name) {
                case 'InitCortexContext':
                  contextManagementResult = await InitCortexContext.execute(
                    toolUse.input,
                    this.config.projectPath || process.cwd()
                  );
                  break;

                default:
                  throw new Error(`Unknown context management tool: ${toolUse.name}`);
              }

              result = {
                success: true,
                llmContent: JSON.stringify(contextManagementResult, null, 2),
                metadata: {
                  source: 'context-management',
                  toolName: toolUse.name
                }
              };
            }
            // Phase 2.6: Execute MCP management tool
            else if (isMcpManagementTool) {
              if (this.config.debug) {
                console.log(`[Orchestrator Phase 2.6] Executing MCP management tool: ${toolUse.name}`);
              }

              let mcpManagementResult: any;

              // Get connected servers info
              const serverNames = this.mcpManager?.getServerNames() || [];
              const connectedServers = new Set<string>();
              const connectedServersMap = new Map<string, number>();

              serverNames.forEach((serverName: string) => {
                if (this.mcpManager?.isServerConnected(serverName)) {
                  connectedServers.add(serverName);
                  // Get tools for this server from getAllTools
                  const allTools = this.mcpManager.getAllTools();
                  const serverTools = allTools.filter(t => t.serverName === serverName);
                  connectedServersMap.set(serverName, serverTools.length);
                }
              });

              // Execute the appropriate management tool
              switch (toolUse.name) {
                case 'ListAvailableMcpServers':
                  mcpManagementResult = await ListAvailableMcpServers.execute(
                    toolUse.input,
                    this.getMcpServerRegistry()!,
                    this.mcpConfigManager!,
                    connectedServers
                  );
                  break;

                case 'SearchMcpServers':
                  mcpManagementResult = await SearchMcpServers.execute(
                    toolUse.input,
                    this.getMcpServerRegistry()!
                  );
                  break;

                case 'GetMcpConfig':
                  mcpManagementResult = await GetMcpConfig.execute(
                    toolUse.input,
                    this.mcpConfigManager!,
                    this.config.projectPath || process.cwd(),
                    connectedServersMap
                  );
                  break;

                case 'EnableMcpServer':
                  mcpManagementResult = await EnableMcpServer.execute(
                    toolUse.input,
                    this.getMcpServerRegistry()!,
                    this.mcpConfigManager!,
                    this.config.projectPath || process.cwd()
                  );
                  break;

                case 'DisableMcpServer':
                  mcpManagementResult = await DisableMcpServer.execute(
                    toolUse.input,
                    this.mcpConfigManager!,
                    this.config.projectPath || process.cwd(),
                    connectedServers
                  );
                  break;

                case 'ConfigureMcpServer':
                  mcpManagementResult = await ConfigureMcpServer.execute(
                    toolUse.input,
                    this.mcpConfigManager!,
                    this.config.projectPath || process.cwd()
                  );
                  break;

                case 'InitMcpConfig':
                  mcpManagementResult = await InitMcpConfig.execute(
                    toolUse.input,
                    this.getMcpServerRegistry()!,
                    this.mcpConfigManager!,
                    this.config.projectPath || process.cwd()
                  );
                  break;

                default:
                  throw new Error(`Unknown MCP management tool: ${toolUse.name}`);
              }

              result = {
                success: true,
                llmContent: JSON.stringify(mcpManagementResult, null, 2),
                metadata: {
                  source: 'mcp-management',
                  toolName: toolUse.name
                }
              };
            } else if (isMcpTool && mcpServerName) {
              // Execute MCP tool — use the raw (un-prefixed) name when calling
              // the underlying server, since the prefix is purely for the
              // model-facing surface.
              const rawToolName = this.getRawMcpToolName(toolUse.name);
              if (this.config.debug) {
                console.log(
                  `[Orchestrator Phase 2.5] Executing MCP tool: ${toolUse.name} → ${mcpServerName}/${rawToolName}`,
                );
              }

              const mcpResult = await this.mcpManager!.callTool(
                mcpServerName,
                rawToolName,
                toolUse.input
              );

              // Phase 2.5 Day 4: Convert MCP result to ToolResult format
              // MCP returns: { content: ContentBlock[], isError?: boolean }
              let llmContent: string;

              if (Array.isArray(mcpResult.content)) {
                // MCP content is an array of content blocks (text, image, resource, etc.)
                llmContent = mcpResult.content
                  .map((block: any) => {
                    if (block.type === 'text') {
                      return block.text;
                    } else if (block.type === 'image') {
                      return `[Image: ${block.mimeType || 'image'}]`;
                    } else if (block.type === 'resource') {
                      return `[Resource: ${block.uri || block.resource?.uri}]`;
                    } else {
                      return JSON.stringify(block);
                    }
                  })
                  .join('\n');
              } else if (typeof mcpResult.content === 'string') {
                llmContent = mcpResult.content;
              } else {
                llmContent = JSON.stringify(mcpResult.content);
              }

              result = {
                success: !mcpResult.isError,
                llmContent,
                metadata: {
                  source: 'mcp',
                  serverName: mcpServerName
                }
              };
            } else {
              // Wave 3: Permission check before tool execution
              if (this.permissionsMiddleware) {
                const permissionContext = {
                  sessionId: this.currentSessionId,
                  config: this.config,
                  modelId: this.currentModelId,
                  conversationId: this.currentConversationId,
                  turnNumber: this.turnNumber,
                  approvalMode: this.approvalMode // Pass approval mode for auto-approve logic
                };

                const decision = await this.permissionsMiddleware.checkPermission(
                  toolUse.name,
                  toolUse.input,
                  permissionContext,
                  signal
                );

                if (!decision.allowed) {
                  // Permission denied - throw error with instruction to stop and ask user
                  const rejectionMessage = decision.reason
                    ? `USER REJECTED THIS OPERATION: ${decision.reason}\n\nIMPORTANT: The user has rejected this operation. You must STOP what you are doing and ask the user why they rejected it or ask for clarification on what they want you to do instead. Do not continue with your current plan. Do not attempt alternative approaches without asking first.`
                    : `USER REJECTED THIS OPERATION\n\nIMPORTANT: The user has rejected this operation. You must STOP what you are doing and ask the user why they rejected it or ask for clarification on what they want you to do instead. Do not continue with your current plan. Do not attempt alternative approaches without asking first.`;
                  throw new Error(rejectionMessage);
                }

                if (this.config.debug) {
                  console.log(`[Orchestrator Phase 2.5] Tool ${toolUse.name} approved by permissions system`);
                }
              }

              // Execute regular executor tool
              result = await this.executorRegistry.execute(
                toolUse.name,
                toolUse.input,
                signal
              );

              // Sub-Agent Spawning (Task, Browse, etc. — any tool emitting
              // shouldSpawnSubAgent). The dispatch gate is the metadata
              // contract, not the tool name, so new entry tools can reuse it.
              if (
                result.metadata?.shouldSpawnSubAgent &&
                result.metadata?.agentDefinition &&
                result.metadata?.taskPrompt
              ) {
                if (this.config.debug) {
                  console.log(`[Orchestrator SubAgent] Spawning sub-agent process: ${result.metadata.agentName}`);
                  console.log(`[Orchestrator SubAgent] Agent will run in independent child process with own context`);
                }

                try {
                  // Get or create SubAgentProcessManager (manages child processes)
                  const processManager = this.getOrCreateSubAgentProcessManager();

                  // Extract agent definition from metadata
                  const agentDef: AgentDefinition = result.metadata.agentDefinition;
                  const taskPrompt: string = result.metadata.taskPrompt;
                  // Per-fork env overrides let Browse enable MCP_AUTO_INJECT
                  // for its subagent without affecting the parent process.
                  const envOverrides: Record<string, string> | undefined = result.metadata.envOverrides;

                  // Resolve model: agent definition first, then inherit from parent
                  // Priority: agentDef.model (from .md file) -> parent session -> config default
                  let resolvedModelId: string;

                  // Check agent definition's model (from the .md file)
                  if (agentDef.model && agentDef.model.toLowerCase() !== 'inherit') {
                    const resolved = this.modelAliasResolver.resolve(agentDef.model, { strict: false });
                    if (resolved) {
                      resolvedModelId = resolved.modelId;
                    } else {
                      // Model specified but not found - use parent's model
                      resolvedModelId = this.currentModelId || this.config.defaultModelId;
                    }
                  } else {
                    // No model or 'inherit' - use parent's current model
                    resolvedModelId = this.currentModelId || this.config.defaultModelId;
                  }

                  if (this.config.debug) {
                    console.log(`[Orchestrator SubAgent] Model resolved: ${agentDef.model} -> ${resolvedModelId}`);
                  }

                  // Set up real-time progress streaming for sub-agent
                  // This allows users to see what the sub-agent is doing
                  const eventEmitter = processManager.getEventEmitter();
                  const progressListeners = this.setupSubAgentProgressListeners(eventEmitter, agentDef.name);

                  // Spawn the sub-agent as a child process
                  // This runs in parallel and doesn't consume parent's context window
                  const subAgentResult = await processManager.spawnAgent(
                    agentDef,
                    taskPrompt,
                    {
                      modelOverride: resolvedModelId,
                      timeoutMs: 300000, // 5 minutes default
                      maxTurns: 50,
                      envOverrides,
                      toolUseId: toolUse.id,
                    }
                  );

                  // Clean up event listeners after completion
                  progressListeners.cleanup();

                  if (this.config.debug) {
                    console.log(`[Orchestrator SubAgent] Sub-agent process ${subAgentResult.agentId} completed: ${subAgentResult.status}`);
                    console.log(`[Orchestrator SubAgent] Duration: ${(subAgentResult.durationMs / 1000).toFixed(1)}s, Turns: ${subAgentResult.turnCount}`);
                  }

                  // Format the sub-agent result for LLM consumption
                  const formattedResult = this.formatSubAgentResultForLLM(subAgentResult);

                  // Replace the result with the sub-agent's actual result
                  result = {
                    success: subAgentResult.status === 'completed',
                    llmContent: formattedResult,
                    metadata: {
                      ...result.metadata,
                      subAgentResult: {
                        agentId: subAgentResult.agentId,
                        agentName: subAgentResult.agentName,
                        status: subAgentResult.status,
                        durationMs: subAgentResult.durationMs,
                        turnCount: subAgentResult.turnCount,
                        filesModified: subAgentResult.filesModified,
                        cost: subAgentResult.cost,
                      },
                      // Track that this was a process-based sub-agent
                      executionMode: 'child_process',
                    },
                  };
                } catch (subAgentError: any) {
                  // Sub-agent process failed - return error as tool result
                  if (this.config.debug) {
                    console.error(`[Orchestrator SubAgent] Sub-agent process failed:`, subAgentError.message);
                  }

                  result = {
                    success: false,
                    llmContent: `Sub-agent process execution failed: ${subAgentError.message}\n\n` +
                      `Agent: ${result.metadata.agentName}\n` +
                      `Task: ${result.metadata.taskPrompt?.slice(0, 200)}...\n\n` +
                      `Note: Sub-agents run as independent child processes. Check agent-mode.js logs for details.`,
                    metadata: {
                      ...result.metadata,
                      subAgentError: subAgentError.message,
                      executionMode: 'child_process',
                    },
                  };
                }
              }
            }

            const duration = Date.now() - startTime;

            if (this.config.debug) {
              const retryMsg = attempt > 0 ? ` (after ${attempt} ${attempt === 1 ? 'retry' : 'retries'})` : '';
              const toolType = isMcpTool ? '[MCP]' : '[Executor]';
              console.log(`[Orchestrator Phase 2.5] ${toolType} Tool ${toolUse.name} completed in ${duration}ms${retryMsg}`);
            }

            // Success - break out of retry loop
            break;

          } catch (execError: any) {
            // Phase 2.5 Day 3: Determine if error is retryable
            const isRetryable = this.isRetryableError(execError);
            const isLastAttempt = attempt === MAX_RETRIES;

            if (!isRetryable || isLastAttempt) {
              if (this.config.debug && !isRetryable) {
                console.log(`[Orchestrator Phase 2.5] Error is not retryable: ${execError.message}`);
              }
              throw execError; // Re-throw to outer catch block
            }

            if (this.config.debug) {
              console.warn(`[Orchestrator Phase 2.5] Retryable error on attempt ${attempt + 1}: ${execError.message}`);
            }
          }
        }

        // Convert ToolResult to tool_result content block format
        const rawContent = typeof result.llmContent === 'string' ? result.llmContent : JSON.stringify(result.llmContent);

        // Phase 1: Check if tool result is too large
        const processedResult = this.processToolResult(toolUse.name, rawContent);

        const successPush = {
          tool_use_id: toolUse.id,
          tool_name: toolUse.name,
          content: processedResult.content,
          is_error: processedResult.isError || !result.success,
          metadata: result.metadata,
        };
        results.push(await this.processToolTraining(toolUse, successPush));

      } catch (error: any) {
        // Phase 2.5 Day 3: Enhanced error reporting
        const errorType = error.name || 'Error';
        const errorMsg = error.message || 'Unknown error';

        if (this.config.debug) {
          console.error(`[Orchestrator Phase 2.5] Tool execution failed for ${toolUse.name} [${errorType}]: ${errorMsg}`);
        }

        const errorPush = {
          tool_use_id: toolUse.id,
          tool_name: toolUse.name,
          content: `Tool execution failed: ${errorMsg}\nError type: ${errorType}`,
          is_error: true,
        };
        results.push(await this.processToolTraining(toolUse, errorPush));
      }
    }

    return results;
  }

  /**
   * Execute a single tool call - extracted for parallel execution support
   *
   * @param toolUse The tool use block to execute
   * @param signal AbortSignal for cancellation
   * @returns Single tool result
   */
  /**
   * Training-aware wrapper around executeSingleToolCall. Looks up priors
   * for the same (toolName, input) and prepends a system-reminder when
   * relevant; records the outcome to the decision store afterwards. Both
   * sides are individually env-gated and never block tool execution.
   */
  private async executeSingleToolCallWithTraining(
    toolUse: { id: string; name: string; input: any },
    signal: AbortSignal,
  ): Promise<{ tool_use_id: string; tool_name: string; content: string; is_error?: boolean; metadata?: any }> {
    const result = await this.executeSingleToolCall(toolUse, signal);
    return await this.processToolTraining(toolUse, result);
  }

  private async executeSingleToolCall(
    toolUse: { id: string; name: string; input: any },
    signal: AbortSignal
  ): Promise<{ tool_use_id: string; tool_name: string; content: string; is_error?: boolean; metadata?: any }> {
    try {
      if (this.config.debug) {
        console.log(`[Orchestrator] Executing single tool: ${toolUse.name}`);
      }

      // Context management tools
      const contextManagementToolNames = ['InitCortexContext'];
      const isContextManagementTool = contextManagementToolNames.includes(toolUse.name);

      // MCP management tools
      const mcpManagementToolNames = [
        'ListAvailableMcpServers', 'SearchMcpServers', 'GetMcpConfig',
        'EnableMcpServer', 'DisableMcpServer', 'ConfigureMcpServer', 'InitMcpConfig'
      ];
      const isMcpManagementTool = mcpManagementToolNames.includes(toolUse.name);

      // Check if MCP tool
      const mcpServerName = this.getMcpServerForTool(toolUse.name);
      const isMcpTool = mcpServerName !== undefined;

      // Check if tool exists
      if (!isContextManagementTool && !isMcpManagementTool && !isMcpTool && !this.executorRegistry.hasExecutor(toolUse.name)) {
        // #17 — surface closest matches inline (same nudge as the streaming
        // dispatch path's Unknown-tool branch).
        const availableExecutors = this.executorRegistry.getExecutorNames();
        const availableMcpTools = this.mcpManager
          ? this.mcpManager.getAllTools().map((t) => t.name)
          : [];
        const allAvailable = [
          ...availableExecutors,
          ...availableMcpTools,
          ...contextManagementToolNames,
          ...mcpManagementToolNames,
        ];
        const suggestions = closestToolMatches(toolUse.name, allAvailable, 3);
        const suggestionPart = suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : '';
        const errorMessage = `Unknown tool: ${toolUse.name}.${suggestionPart}`;
        return {
          tool_use_id: toolUse.id,
          tool_name: toolUse.name,
          content: errorMessage,
          is_error: true
        };
      }

      // Permission check before execution (for non-MCP, non-context tools)
      if (this.permissionsMiddleware && !isContextManagementTool && !isMcpManagementTool && !isMcpTool) {
        const permissionContext = {
          sessionId: this.currentSessionId,
          config: this.config,
          modelId: this.currentModelId,
          conversationId: this.currentConversationId,
          turnNumber: this.turnNumber,
          approvalMode: this.approvalMode
        };

        const decision = await this.permissionsMiddleware.checkPermission(
          toolUse.name,
          toolUse.input,
          permissionContext,
          signal
        );

        if (!decision.allowed) {
          return {
            tool_use_id: toolUse.id,
            tool_name: toolUse.name,
            content: `Permission denied: ${decision.reason || 'Operation not allowed'}`,
            is_error: true
          };
        }
      }

      // Execute the tool (using executor registry)
      const result = await this.executorRegistry.execute(toolUse.name, toolUse.input, signal);

      // Handle any sub-agent-spawning tool (Task, Browse, etc.). The dispatch
      // gate is the metadata contract, not the tool name — that way Browse and
      // future entry tools can reuse the same path without duplication.
      if (
        result.metadata?.shouldSpawnSubAgent &&
        result.metadata?.agentDefinition &&
        result.metadata?.taskPrompt
      ) {
        const processManager = this.getOrCreateSubAgentProcessManager();
        const agentDef: AgentDefinition = result.metadata.agentDefinition;
        const taskPrompt: string = result.metadata.taskPrompt;
        // Per-fork env overrides let the subagent get capabilities the parent
        // withholds — Browse uses this to enable MCP_AUTO_INJECT for the
        // subagent's process only.
        const envOverrides: Record<string, string> | undefined = result.metadata.envOverrides;

        // Resolve model
        let resolvedModelId: string;
        if (agentDef.model && agentDef.model.toLowerCase() !== 'inherit') {
          const resolved = this.modelAliasResolver.resolve(agentDef.model, { strict: false });
          resolvedModelId = resolved?.modelId || this.currentModelId || this.config.defaultModelId;
        } else {
          resolvedModelId = this.currentModelId || this.config.defaultModelId;
        }

        if (this.config.debug) {
          console.log(`[Orchestrator] Spawning sub-agent: ${agentDef.name} with model ${resolvedModelId}${envOverrides ? ` (env: ${Object.keys(envOverrides).join(',')})` : ''}`);
        }

        // Set up progress streaming
        const eventEmitter = processManager.getEventEmitter();
        const progressListeners = this.setupSubAgentProgressListeners(eventEmitter, agentDef.name);

        try {
          const subAgentResult = await processManager.spawnAgent(agentDef, taskPrompt, {
            modelOverride: resolvedModelId,
            timeoutMs: 300000,
            maxTurns: 50,
            envOverrides,
            toolUseId: toolUse.id,
          });

          progressListeners.cleanup();

          const formattedResult = this.formatSubAgentResultForLLM(subAgentResult);
          const rawContent = typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult);
          const processedResult = this.processToolResult(toolUse.name, rawContent);

          return {
            tool_use_id: toolUse.id,
            tool_name: toolUse.name,
            content: processedResult.content,
            is_error: subAgentResult.status !== 'completed',
            metadata: {
              ...result.metadata,
              subAgentResult: {
                agentId: subAgentResult.agentId,
                agentName: subAgentResult.agentName,
                status: subAgentResult.status,
                durationMs: subAgentResult.durationMs,
                turnCount: subAgentResult.turnCount,
                filesModified: subAgentResult.filesModified,
              },
              executionMode: 'child_process',
            },
          };
        } catch (subAgentError: any) {
          progressListeners.cleanup();
          return {
            tool_use_id: toolUse.id,
            tool_name: toolUse.name,
            content: `Sub-agent process execution failed: ${subAgentError.message}`,
            is_error: true,
            metadata: { ...result.metadata, subAgentError: subAgentError.message },
          };
        }
      }

      // Standard tool result
      const rawContent = typeof result.llmContent === 'string' ? result.llmContent : JSON.stringify(result.llmContent);
      const processedResult = this.processToolResult(toolUse.name, rawContent);

      return {
        tool_use_id: toolUse.id,
        tool_name: toolUse.name,
        content: processedResult.content,
        is_error: processedResult.isError || !result.success,
        metadata: result.metadata
      };

    } catch (error: any) {
      const errorType = error.name || 'Error';
      const errorMsg = error.message || 'Unknown error';

      if (this.config.debug) {
        console.error(`[Orchestrator] Tool execution failed for ${toolUse.name}: ${errorMsg}`);
      }

      return {
        tool_use_id: toolUse.id,
        tool_name: toolUse.name,
        content: `Tool execution failed: ${errorMsg}\nError type: ${errorType}`,
        is_error: true
      };
    }
  }

  /**
   * Determine if an error is retryable
   *
   * Phase 2.5 Day 3: Error classification for retry logic
   *
   * @param error The error to check
   * @returns true if the error is transient and should be retried
   */
  private isRetryableError(error: any): boolean {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorName = error.name?.toLowerCase() || '';

    // Network/connection errors - retryable
    const networkErrors = [
      'econnreset',
      'econnrefused',
      'etimedout',
      'enetunreach',
      'ehostunreach',
      'socket hang up',
      'network error',
      'fetch failed'
    ];

    if (networkErrors.some(pattern => errorMessage.includes(pattern) || errorName.includes(pattern))) {
      return true;
    }

    // HTTP status codes that are retryable
    const statusCode = error.status || error.statusCode;
    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];

    if (statusCode && retryableStatusCodes.includes(statusCode)) {
      return true;
    }

    // Temporary file system errors - retryable
    if (errorMessage.includes('ebusy') || errorMessage.includes('eagain')) {
      return true;
    }

    // Abort errors - NOT retryable (user/timeout initiated)
    if (errorName === 'aborterror' || errorMessage.includes('abort')) {
      return false;
    }

    // Permission/validation errors - NOT retryable
    const nonRetryablePatterns = [
      'permission denied',
      'eacces',
      'enoent', // File not found
      'invalid',
      'validation failed',
      'unauthorized',
      'forbidden'
    ];

    if (nonRetryablePatterns.some(pattern => errorMessage.includes(pattern) || errorName.includes(pattern))) {
      return false;
    }

    // Default: don't retry unknown errors
    return false;
  }

  // ============================================
  // PRIVATE METHODS - UTILITIES
  // ============================================

  /**
   * Convert MCP tools to CanonicalTool format
   *
   * Phase 2.5 Day 4: MCP tool integration
   *
   * @returns Array of CanonicalTools from MCP servers
   */
  private getMcpToolsAsCanonical(): any[] {
    if (!this.mcpManager) {
      return [];
    }

    const mcpTools = this.mcpManager.getAllTools();

    // Surface every MCP tool with a `<serverName>__<rawName>` prefix so the
    // model gets an unambiguous, server-qualified handle. Without prefixing,
    // bare names like `browse` collide with the model's PascalCase native
    // tool conventions and tools across servers can shadow each other.
    return mcpTools.map(tool => ({
      name: prefixMcpToolName(tool.serverName, tool.name),
      description: tool.description || `MCP tool from ${tool.serverName}`,
      schema: tool.inputSchema || { type: 'object', properties: {} },
      metadata: {
        source: 'mcp',
        serverName: tool.serverName,
        rawToolName: tool.name,
        mcpTool: true,
      },
    }));
  }

  /**
   * Get MCP management tools as CanonicalTools
   *
   * Phase 2.6: MCP Model Management Tools
   *
   * These tools allow models to discover, enable, configure, and manage MCP servers autonomously.
   *
   * @returns Array of MCP management tools
   */
  private getMcpManagementTools(): any[] {
    // Only provide management tools if MCP is enabled
    if (!this.mcpConfigManager || !this.getMcpServerRegistry()) {
      return [];
    }

    return [
      ListAvailableMcpServers.toCanonicalTool(),
      SearchMcpServers.toCanonicalTool(),
      GetMcpConfig.toCanonicalTool(),
      EnableMcpServer.toCanonicalTool(),
      DisableMcpServer.toCanonicalTool(),
      ConfigureMcpServer.toCanonicalTool(),
      InitMcpConfig.getToolDefinition()
    ] as any[];
  }

  /**
   * Get context management tools
   *
   * These tools allow models to generate and manage project context (CORTEX.md).
   *
   * @returns Array of context management tools
   */
  private getContextManagementTools(): any[] {
    const def = InitCortexContext.getToolDefinition();
    // Promote the init tool from deferred to 'essential' ONLY when this project has no
    // CORTEX.md yet — so an uninitialized project can discover/run it (the model never
    // thinks to SearchTools for a deferred setup tool), but it drops back to deferred
    // (lean context) once CORTEX.md exists and there's nothing to initialize.
    try {
      const projectPath = this.config.projectPath || process.cwd();
      const hasCortexMd = existsSync(pathJoin(projectPath, '.cortex', 'CORTEX.md'));
      if (!hasCortexMd) {
        def.discoveryTier = 'essential';
      }
    } catch { /* on any fs error, leave the tool at its default (deferred) tier */ }
    return [def] as any[];
  }

  // ============================================
  // SUB-AGENT METHODS
  // ============================================

  /**
   * Get or create SubAgentProcessManager instance
   *
   * Lazy initialization pattern - only creates manager when first Task tool is executed.
   * This avoids overhead for sessions that don't use sub-agents.
   *
   * Sub-agents run as independent child processes:
   * - True parallelism (multiple agents can run simultaneously)
   * - Independent context windows (don't consume parent's context)
   * - Process isolation (crashes don't affect parent)
   *
   * @returns SubAgentProcessManager instance
   */
  /**
   * Inject team briefing into parallel Task tool calls.
   *
   * When multiple Task tools are dispatched in parallel, each agent benefits from
   * knowing about its teammates. This method enriches each Task tool's prompt with
   * a briefing section listing all parallel assignments.
   *
   * @param taskTools Array of Task tool_use blocks being dispatched in parallel
   * @returns The same array with enriched prompts
   */
  private injectTeamBriefing(
    taskTools: Array<{ id: string; name: string; input: any }>
  ): Array<{ id: string; name: string; input: any }> {
    if (taskTools.length <= 1) return taskTools;

    // Build teammate summary
    const assignments = taskTools.map(t => ({
      agentType: t.input?.subagent_type || 'general',
      description: t.input?.description || 'unknown task',
    }));

    return taskTools.map((toolUse, idx) => {
      const teammates = assignments
        .filter((_, i) => i !== idx)
        .map(a => `- ${a.agentType}: ${a.description}`)
        .join('\n');

      const briefing = `\n\n **Team Briefing**\nYou are part of a ${taskTools.length}-agent team working in parallel.\n\nTeammates:\n${teammates}\n\nThe orchestrator will forward relevant findings from teammates.\nFocus on YOUR assignment. Do not duplicate others' work.\n\n---\n\n`;

      return {
        ...toolUse,
        input: {
          ...toolUse.input,
          prompt: briefing + (toolUse.input?.prompt || ''),
        },
      };
    });
  }

  private getOrCreateSubAgentProcessManager(): SubAgentProcessManager {
    if (!this.subAgentProcessManager) {
      // Pass the parent's approval handler so sub-agent permission requests
      // are forwarded to the user with full tool details visible
      const approvalHandler = this.getApprovalHandler();

      this.subAgentProcessManager = createSubAgentProcessManager(
        this.config.projectPath,
        this.currentSessionId,
        this.currentModelId,
        {
          maxConcurrentAgents: 5,
          debug: this.config.debug,
          approvalHandler, // Forward sub-agent permissions to user
        }
      );

      if (this.config.debug) {
        console.log(`[Orchestrator SubAgent] Created SubAgentProcessManager for session ${this.currentSessionId}`);
        console.log(`[Orchestrator SubAgent] Sub-agents will run as independent child processes`);
        console.log(`[Orchestrator SubAgent] Sub-agent permissions will be forwarded to parent approval handler`);
      }
    }

    return this.subAgentProcessManager;
  }

  /**
   * Set up real-time progress listeners for sub-agent events
   *
   * Subscribes to events from the SubAgentProcessManager and either:
   * - Calls the onSubAgentEvent callback (for UI integration like NeonCortex)
   * - Falls back to console.log (for FuzzyCortex/chalk CLI)
   *
   * @param eventEmitter SubAgent event emitter
   * @param agentName Name of the agent for display
   * @returns Object with cleanup function to remove listeners
   */
  private setupSubAgentProgressListeners(
    eventEmitter: ISubAgentEventEmitter,
    agentName: string
  ): { cleanup: () => void } {
    const prefix = ` [Agent: ${agentName}]`;
    // NOTE: Read callback dynamically each time (not captured once) so that
    // callbacks set after listener setup still work
    const getCallback = () => this.config.onSubAgentEvent;

    // Emit event via callback or console.log
    const emitEvent = (event: SubAgentEvent) => {
      const callback = getCallback();
      if (callback) {
        callback(event);
      } else {
        // Fallback to console.log for CLI
        switch (event.type) {
          case 'started':
            console.log(`\n${prefix} Started (model: ${event.data.model})`);
            break;
          case 'progress':
            console.log(`${prefix} Turn ${event.data.turnNumber} (${(event.data.elapsedMs! / 1000).toFixed(1)}s, ${event.data.totalTokens} tokens)`);
            break;
          case 'tool_call':
            console.log(`${prefix} Using: ${event.data.toolName}${event.data.toolSummary || ''}`);
            break;
          case 'text':
            if (event.data.isFinal && event.data.text) {
              const truncated = event.data.text.length > 200
                ? event.data.text.slice(0, 200) + '...'
                : event.data.text;
              console.log(`${prefix} Response: ${truncated}`);
            }
            break;
          case 'error':
            console.log(`${prefix} Error: ${event.data.error}`);
            break;
        }
      }
    };

    // Handler for agent starting
    const onStarted = (payload: { agentId: string; agentName: string; model: string }) => {
      if (!payload.agentId.startsWith(agentName + '-')) return;
      emitEvent({
        type: 'started',
        agentId: payload.agentId,
        agentName: payload.agentName,
        data: { model: payload.model },
      });
    };

    // Handler for progress updates
    const onProgress = (payload: { agentId: string; turnNumber: number; totalTokens: number; elapsedMs: number }) => {
      if (!payload.agentId.startsWith(agentName + '-')) return;
      emitEvent({
        type: 'progress',
        agentId: payload.agentId,
        agentName,
        data: {
          turnNumber: payload.turnNumber,
          totalTokens: payload.totalTokens,
          elapsedMs: payload.elapsedMs,
        },
      });
    };

    // Handler for tool calls - shows what the agent is doing
    const onToolCall = (payload: { agentId: string; toolName: string; toolId: string; toolInput: Record<string, unknown> }) => {
      if (!payload.agentId.startsWith(agentName + '-')) return;
      const toolSummary = this.summarizeToolInput(payload.toolName, payload.toolInput);
      emitEvent({
        type: 'tool_call',
        agentId: payload.agentId,
        agentName,
        data: {
          toolName: payload.toolName,
          toolSummary,
        },
      });
    };

    // Handler for text output from agent
    const onText = (payload: { agentId: string; text: string; isFinal: boolean }) => {
      if (!payload.agentId.startsWith(agentName + '-')) return;
      emitEvent({
        type: 'text',
        agentId: payload.agentId,
        agentName,
        data: {
          text: payload.text,
          isFinal: payload.isFinal,
        },
      });
    };

    // Handler for errors
    const onError = (payload: { agentId: string; agentName: string; error: Error }) => {
      if (!payload.agentId.startsWith(agentName + '-')) return;
      emitEvent({
        type: 'error',
        agentId: payload.agentId,
        agentName: payload.agentName,
        data: { error: payload.error.message },
      });
    };

    // Handler for completion
    const onCompleted = (payload: { agentId: string; result: SubAgentResult }) => {
      if (!payload.agentId.startsWith(agentName + '-')) return;
      emitEvent({
        type: 'completed',
        agentId: payload.agentId,
        agentName: payload.result.agentName,
        data: {
          status: payload.result.status,
          elapsedMs: payload.result.durationMs,
          turnNumber: payload.result.turnCount,
          totalTokens: payload.result.cost.inputTokens + payload.result.cost.outputTokens,
        },
      });
    };

    // Subscribe to events
    eventEmitter.on('agent:started', onStarted);
    eventEmitter.on('agent:progress', onProgress);
    eventEmitter.on('agent:tool_call', onToolCall);
    eventEmitter.on('agent:text', onText);
    eventEmitter.on('agent:error', onError);
    eventEmitter.on('agent:completed', onCompleted);

    // Return cleanup function
    return {
      cleanup: () => {
        eventEmitter.off('agent:started', onStarted);
        eventEmitter.off('agent:progress', onProgress);
        eventEmitter.off('agent:tool_call', onToolCall);
        eventEmitter.off('agent:text', onText);
        eventEmitter.off('agent:error', onError);
        eventEmitter.off('agent:completed', onCompleted);
      }
    };
  }

  /**
   * Summarize tool input for display (keep it short)
   */
  private summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
    if (!input || Object.keys(input).length === 0) {
      return '';
    }

    // For common tools, show the most relevant field
    switch (toolName.toLowerCase()) {
      case 'read':
        return input.file_path ? ` → ${input.file_path}` : '';
      case 'write':
      case 'edit':
        return input.file_path ? ` → ${input.file_path}` : '';
      case 'bash':
        const cmd = input.command as string;
        return cmd ? ` → ${cmd.slice(0, 50)}${cmd.length > 50 ? '...' : ''}` : '';
      case 'grep':
        return input.pattern ? ` → "${input.pattern}"` : '';
      case 'glob':
        return input.pattern ? ` → ${input.pattern}` : '';
      case 'webfetch':
        return input.url ? ` → ${input.url}` : '';
      default:
        // For other tools, show first key-value
        const firstKey = Object.keys(input)[0];
        if (firstKey) {
          const val = String(input[firstKey]).slice(0, 30);
          return ` → ${firstKey}: ${val}${String(input[firstKey]).length > 30 ? '...' : ''}`;
        }
        return '';
    }
  }

  /**
   * Format SubAgentResult for LLM consumption
   *
   * Fire-and-forget: generate a session title from the first user message
   * and persist it in the session .meta.json.
   */
  private async generateAndSaveSessionTitle(firstUserMessage: string): Promise<void> {
    try {
      const title = await this.helperMiddleware.generateSessionTitle(firstUserMessage);
      if (title) {
        await this.historyStore.saveMetadata(this.currentSessionId, { title });
        if (this.config.debug) {
          console.log(`[Orchestrator] Session title generated: "${title}"`);
        }
      }
    } catch (err: unknown) {
      if (this.config.debug) {
        console.warn('[Orchestrator] Session title generation failed:', (err as Error)?.message);
      }
    }
  }

  /**
   * Converts the structured SubAgentResult into a format suitable for the tool result.
   *
   * @param result SubAgentResult from completed sub-agent
   * @returns Formatted string for LLM
   */
  private formatSubAgentResultForLLM(result: SubAgentResult): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Sub-Agent Result: ${result.agentName}`);
    lines.push('');

    // Status
    const statusEmoji = result.status === 'completed' ? '[OK]' :
                        result.status === 'interrupted' ? '⚠' :
                        result.status === 'timeout' ? '⏱' : '[ERROR]';
    lines.push(`**Status**: ${statusEmoji} ${result.status.toUpperCase()}`);
    lines.push(`**Model**: ${result.model}`);
    lines.push(`**Duration**: ${(result.durationMs / 1000).toFixed(1)}s`);
    lines.push(`**Turns**: ${result.turnCount}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(result.summary);
    lines.push('');

    // Files modified (if any)
    if (result.filesModified.length > 0) {
      lines.push('## Files Modified');
      lines.push('');
      result.filesModified.forEach(f => lines.push(`- ${f}`));
      lines.push('');
    }

    // Files read (if any)
    if (result.filesRead.length > 0) {
      lines.push('## Files Read');
      lines.push('');
      result.filesRead.forEach(f => lines.push(`- ${f}`));
      lines.push('');
    }

    // Tools used
    if (result.toolsUsed.length > 0) {
      lines.push('## Tools Used');
      lines.push('');
      result.toolsUsed.forEach(t => {
        const errStr = t.errors > 0 ? ` (${t.errors} errors)` : '';
        lines.push(`- **${t.name}**: ${t.callCount} calls, ${(t.totalDuration / 1000).toFixed(1)}s${errStr}`);
      });
      lines.push('');
    }

    // Cost
    lines.push('## Token Usage');
    lines.push('');
    lines.push(`- Input: ${result.cost.inputTokens.toLocaleString()}`);
    lines.push(`- Output: ${result.cost.outputTokens.toLocaleString()}`);
    if (result.cost.cacheHits > 0) {
      lines.push(`- Cache Hits: ${result.cost.cacheHits}`);
    }
    lines.push(`- Estimated Cost: $${result.cost.estimatedCost.toFixed(4)}`);
    lines.push('');

    // Error details (if failed)
    if (result.error) {
      lines.push('## Error');
      lines.push('');
      lines.push(`**Type**: ${result.error.type}`);
      lines.push(`**Message**: ${result.error.message}`);
      lines.push('');
    }

    // Full response (truncated if very long)
    if (result.fullResponse) {
      lines.push('## Full Response');
      lines.push('');
      const maxLen = 5000;
      if (result.fullResponse.length > maxLen) {
        lines.push(result.fullResponse.slice(0, maxLen));
        lines.push('');
        lines.push(`... (truncated, ${result.fullResponse.length - maxLen} chars omitted)`);
      } else {
        lines.push(result.fullResponse);
      }
    }

    return lines.join('\n');
  }

  /**
   * Check if a tool is an MCP tool by name
   *
   * Phase 2.5 Day 4: MCP tool detection
   *
   * @param toolName Name of the tool
   * @returns ServerName if it's an MCP tool, undefined otherwise
   */
  private getMcpServerForTool(toolName: string): string | undefined {
    if (!this.mcpManager) {
      return undefined;
    }

    // Round 15 (cortex parallel-bench finding): fetch the tool list ONCE.
    // Previously this method called mcpManager.getAllTools() twice — once
    // for the prefixed-name path and once for the back-compat scan — and
    // fires per MCP-routed tool call.
    const mcpTools = this.mcpManager.getAllTools();

    // Preferred form: `<serverName>__<rawName>`. Validate that the parsed
    // server is actually connected before accepting it as MCP-routed.
    const parsed = parseMcpToolName(toolName);
    if (parsed) {
      const exists = mcpTools.some(
        (t) => t.serverName === parsed.serverName && t.name === parsed.toolName,
      );
      if (exists) return parsed.serverName;
    }

    // Back-compat: also accept the raw, unprefixed name when only one server
    // exposes a tool by that name. This lets older callers and stragglers
    // continue working but logs a warning so they get migrated.
    const matches = mcpTools.filter((t) => t.name === toolName);
    if (matches.length === 1) {
      return matches[0]!.serverName;
    }
    return undefined;
  }

  /**
   * Resolve the raw (un-prefixed) tool name for an MCP tool reference. The
   * input may be either `<serverName>__<rawName>` (preferred) or the raw
   * name (back-compat). Returns the raw name suitable for `mcpManager.callTool`.
   */
  private getRawMcpToolName(toolName: string): string {
    const parsed = parseMcpToolName(toolName);
    return parsed ? parsed.toolName : toolName;
  }

  // ============================================
  // TRAINING PIPELINE — LOOKUP-BEFORE-ACTION
  // ============================================
  // Lookup-before-action decision priors.
  // SpacetimeDB → local JSONL backend for the standalone OSS harness.
  //
  // Reactive design: AFTER each tool execution, look up priors for the
  // same (toolName, inputHash). If failures exist in the corpus, prepend a
  // <system-reminder> to the tool_result content so the model sees the
  // prior context when deciding the next step. Record the current outcome
  // AFTER the lookup so it doesn't pollute its own priors.
  //
  // Gated by env vars CORTEX_RECORD_DECISIONS / CORTEX_LOOKUP_PRIOR_DECISIONS
  // (both default true). Rotation cap tunable via CORTEX_DECISIONS_MAX_BYTES
  // (positive int bytes; default 2 MB — resolved in the DecisionStore ctor).
  // ============================================

  private decisionStore: DecisionStore | undefined;
  private routerMatrix: ModelRouterMatrix | undefined;

  private getRouterMatrix(): ModelRouterMatrix {
    if (!this.routerMatrix) {
      const root = this.config.projectPath || process.cwd();
      this.routerMatrix = new ModelRouterMatrix(root);
    }
    return this.routerMatrix;
  }

  private getDecisionStore(): DecisionStore | undefined {
    if (this.isRecordingEnabled() === false && this.isLookupEnabled() === false) {
      return undefined;
    }
    if (!this.decisionStore) {
      const root = this.config.projectPath || process.cwd();
      const storePath = `${root}/.cortex/decisions.jsonl`;
      this.decisionStore = new DecisionStore(storePath);
    }
    return this.decisionStore;
  }

  private isRecordingEnabled(): boolean {
    return process.env.CORTEX_RECORD_DECISIONS !== 'false';
  }

  private isLookupEnabled(): boolean {
    return process.env.CORTEX_LOOKUP_PRIOR_DECISIONS !== 'false';
  }

  /**
   * Apply lookup-before-action training: prepend a <system-reminder> with
   * prior decision context (only when there are prior failures for this
   * exact tool+input) and record the current outcome.
   *
   * Returns the (possibly-augmented) result. Failures in the store path
   * are swallowed so training never breaks tool execution.
   */
  private async processToolTraining(
    toolUse: { id: string; name: string; input: any },
    result: { tool_use_id: string; tool_name: string; content: string; is_error?: boolean; metadata?: any },
  ): Promise<typeof result> {
    const store = this.getDecisionStore();
    if (!store) return result;

    const inputHash = stableInputHash(toolUse.input);
    let augmented = result;

    // 1. Lookup priors (read side) — only emits reminder when failures exist.
    //    Fetch the 3 most recent matching decisions so the formatter can
    //    surface specific past outcomes (prior-outcome surfacing).
    if (this.isLookupEnabled()) {
      try {
        const [stats, recent] = await Promise.all([
          store.stats(toolUse.name, inputHash),
          store.recent(toolUse.name, inputHash, 3),
        ]);
        const reminder = formatPriorReminder(toolUse.name, stats, recent);
        if (reminder && result.content) {
          augmented = { ...result, content: reminder + result.content };
        }
      } catch (err) {
        if (this.config.debug) {
          console.warn('[Training] prior lookup failed:', err);
        }
      }
    }

    // 2. Record outcome (write side) — strictly after lookup so the new
    //    entry doesn't count toward its own priors.
    if (this.isRecordingEnabled()) {
      try {
        await store.record({
          sessionId: this.currentSessionId ?? 'unknown',
          toolName: toolUse.name,
          input: toolUse.input,
          success: !result.is_error,
          ...(result.is_error
            ? { errorSnippet: String(result.content).slice(0, 200) }
            : {}),
        });
      } catch (err) {
        if (this.config.debug) {
          console.warn('[Training] decision recording failed:', err);
        }
      }
    }

    return augmented;
  }

  // ============================================
  // REACTIVE MENTORSHIP METHODS
  // ============================================
  // NOTE: shouldTriggerMentorship() is now handled by MentorshipMiddleware
  // Method has been removed in favor of middleware delegation (see line 959-961)

  /**
   * Inject thinking block into message history
   *
   * Reactive Mentorship: Phase 1 - Thinking Block Injection
   *
   * Creates a synthetic thinking block message from helper model guidance
   */
  private async injectThinkingBlock(thinking: string, source: 'error' | 'keyword' | 'periodic' | 'pattern' | 'interleaved' | 'active_discovery' | 'team_update' | 'guidance'): Promise<void> {
    if (!this.sessionTimeline) {
      return; // Cannot inject without timeline
    }

    // Create thinking block message with metadata for visual distinction
    const thinkingMessageId = uuidv4();
    const helperModelId = this.config.reactiveMentorship?.helperModelId || 'grok-4-1-fast-non-reasoning';

    // Check current model's API pattern AND provider to determine content format.
    // Only inject thinking blocks for adapters that truly handle them:
    // - Anthropic Messages API: native thinking block support (extended/interleaved thinking)
    // - Google GenerateContent API: converts thinking to [Thinking: ...] text parts (safe)
    // All others get <system-reminder> text — they either strip thinking blocks (XAI Messages,
    // GoogleGenAI SDK) or don't recognize them (Chat Completions, Responses), resulting in
    // empty content arrays and "Each message must have at least one content element" errors.
    const currentModel = this.modelRegistry?.getModel(this.currentModelId);
    const apiPattern = currentModel?.api?.pattern || 'chat/completions';
    // Anthropic requires `signature` on thinking blocks (model-generated, can't be synthesized).
    // Synthetic mentorship thinking blocks must use text format for Anthropic.
    // Only Google GenerateContent safely converts thinking → text parts.
    const supportsThinking = apiPattern === 'generateContent';

    const contentBlocks: any[] = [];

    if (supportsThinking) {
      // Adapter handles thinking blocks — inject as thinking
      contentBlocks.push({
        type: 'thinking',
        thinking: ` **AI Mentor Insight** (${source})\n\n${thinking}`,
        thinkingMetadata: {
          source: 'mentorship',
          modelId: helperModelId
        }
      });
    } else {
      // Inject as system-reminder text in a user message (NOT assistant).
      // Using assistant role caused models (DeepSeek, Grok) to see guidance as their
      // own previous response and mimic the <system-reminder> pattern. User messages
      // with <system-reminder> tags are the standard injection pattern used by
      // SystemMessageMiddleware — models are conditioned to expect these in user messages.
      contentBlocks.push({
        type: 'text',
        text: `<system-reminder>\n AI Mentor Insight (${source})\n\n${thinking}\n</system-reminder>`
      });
    }

    // For non-thinking models, inject as user message to avoid model echo pattern.
    // Models see assistant messages as their own prior output and may mimic the format.
    const useUserRole = !supportsThinking;
    const messageRole = useUserRole ? 'user' : 'assistant';

    const thinkingMessage: Message = {
      uuid: thinkingMessageId,
      timestamp: new Date().toISOString(),
      type: messageRole,
      message: {
        role: messageRole,
        content: contentBlocks
      },
      timeline: {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber
      },
      model: {
        id: this.config.reactiveMentorship?.helperModelId || 'grok-4-1-fast-non-reasoning',
        provider: 'xai',
        apiPattern: 'chat/completions'
      },
      metadata: {
        mentorshipGuidance: true,
        syntheticReasoning: true,
        ephemeral: true,
        source
      }
    } as any;

    // Record in timeline (for debugging/analytics — lightweight metadata, not conversation content)
    this.sessionTimeline.recordMessage(thinkingMessageId, messageRole);

    // Add to in-memory history (visible to model during current turn's tool loop)
    // but do NOT persist to JSONL — mentorship guidance is ephemeral
    this.messageHistory.push(thinkingMessage);

    // NOTE: No historyStore.appendMessage() call — thinking blocks are ephemeral.
    // They exist in messageHistory during the current turn so the model sees them
    // in API calls, but are cleaned up after the turn completes (see cleanupEphemeralMessages).
    // This prevents mentorship blocks from accumulating across turns, polluting context
    // budget, and breaking prompt cache prefix stability.

    if (this.config.debug) {
      console.log(`[Orchestrator Mentorship] Injected ephemeral thinking block from ${source} trigger`);
    }
  }

  /**
   * Inject guidance from the orchestrator or a sibling agent into the conversation.
   *
   * Reuses the same dual-path as injectThinkingBlock():
   * - For thinking-capable APIs (Google GenerateContent): thinking block
   * - For all others: <system-reminder> text
   *
   * The guidance is ephemeral — cleaned up after the current turn via cleanupEphemeralMessages().
   * This is the public API for cross-agent communication (team updates, guidance forwarding).
   *
   * @param text The guidance text to inject
   * @param source Label for the guidance source (e.g., 'team_update', 'guidance')
   */
  public injectGuidance(text: string, source: 'team_update' | 'guidance' = 'guidance'): void {
    this.injectThinkingBlock(text, source);
  }

  /**
   * Remove ephemeral mentorship messages from in-memory history after a turn completes.
   *
   * Mentorship thinking blocks are injected during the tool loop so the model sees them
   * in API calls, but they should NOT persist across turns because:
   * 1. Old guidance is stale (reflects on previous tool results)
   * 2. Accumulation pollutes context budget
   * 3. Changing content in mid-history breaks prompt cache prefix stability
   *
   * These messages were never written to JSONL (injectThinkingBlock skips appendMessage),
   * so this cleanup just removes them from the in-memory array.
   */
  private cleanupEphemeralMessages(): void {
    const beforeCount = this.messageHistory.length;
    this.messageHistory = this.messageHistory.filter(
      (msg: any) => !msg.metadata?.ephemeral
    );
    const removedCount = beforeCount - this.messageHistory.length;

    if (removedCount > 0 && this.config.debug) {
      console.log(`[Orchestrator Context] Cleaned up ${removedCount} ephemeral mentorship message(s)`);
    }
  }

  /**
   * Detect mentorship keywords in user message
   *
   * Reactive Mentorship: Phase 1 - Keyword Detection
   */
  private detectMentorshipKeyword(content: string | any[]): string | null {
    if (!this.config.reactiveMentorship?.enabled || !this.config.reactiveMentorship?.enableKeywords) {
      return null;
    }

    // Convert to string for keyword detection
    // Handles: plain string, content block arrays [{type:'text', text:'...'}],
    // and message arrays [{role:'user', content:'...'}] (from server route)
    const textContent = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map(block => {
            if (typeof block === 'string') return block;
            if (typeof block === 'object') {
              // Content block format: {type: 'text', text: '...'}
              if (block.type === 'text' && block.text) return block.text;
              // Message format: {role: 'user', content: '...'}
              if (block.role && block.content) return typeof block.content === 'string' ? block.content : '';
            }
            return '';
          }).join(' ')
        : '';

    // Check for default keywords
    const keywords = ['@ultrathink', '@analyze', '@rethink', '@mentor'];

    // Add custom keywords if configured
    if (this.config.reactiveMentorship.customKeywords) {
      keywords.push(...this.config.reactiveMentorship.customKeywords);
    }

    for (const keyword of keywords) {
      if (textContent.includes(keyword)) {
        return keyword;
      }
    }

    return null;
  }

  /**
   * Remove keyword from content
   *
   * Reactive Mentorship: Phase 1 - Keyword Removal
   */
  private removeKeyword(content: string | any[], keyword: string): string | any[] {
    if (typeof content === 'string') {
      return content.replace(keyword, '').trim();
    }

    if (Array.isArray(content)) {
      return content.map(block => {
        if (typeof block === 'object') {
          // Content block format: {type: 'text', text: '...'}
          if (block.type === 'text' && block.text) {
            return { ...block, text: block.text.replace(keyword, '').trim() };
          }
          // Message format: {role: 'user', content: '...'}
          if (block.role && typeof block.content === 'string') {
            return { ...block, content: block.content.replace(keyword, '').trim() };
          }
        }
        return block;
      });
    }

    return content;
  }

  // ============================================================
  // Phase 2 Mentorship Features
  // ============================================================

  /**
   * Check if periodic review should trigger (Phase 2)
   */
  private shouldTriggerPeriodicReview(): boolean {
    if (!this.config.reactiveMentorship?.enabled || !this.config.reactiveMentorship?.turnBasedEnabled) {
      return false;
    }

    const interval = this.config.reactiveMentorship.turnInterval || 10;

    // Trigger every N turns (but not at turn 0)
    return this.turnNumber > 0 && this.turnNumber % interval === 0;
  }

  /**
   * Handle periodic review (Phase 2)
   */
  private async handlePeriodicReview(): Promise<void> {
    if (this.config.debug) {
      console.log(`[Orchestrator Mentorship] Periodic review triggered (turn ${this.turnNumber})`);
    }

    try {
      const includeAdvice = true; // Default to strategic review

      const guidance = await this.helperMiddleware.generatePeriodicReview({
        turnNumber: this.turnNumber,
        recentHistory: this.messageHistory,
        includeStrategicAdvice: includeAdvice,
        helperModelId: this.config.reactiveMentorship?.helperModelId
      });

      await this.injectThinkingBlock(guidance, 'keyword'); // Use 'keyword' type for periodic reviews

      if (this.config.debug) console.log(`[Orchestrator Mentorship] Periodic review injected (turn ${this.turnNumber})`);
    } catch (error: any) {
      console.error(`[Orchestrator Mentorship] Failed to generate periodic review:`, error.message);
    }
  }

  /**
   * Track error pattern for pattern detection (Phase 2)
   */
  private trackErrorPattern(errorMessage: string): void {
    if (!this.config.reactiveMentorship?.enabled || !this.config.reactiveMentorship?.patternDetection) {
      return;
    }

    // Extract error pattern (simplified - could be enhanced with ML)
    const pattern = this.extractErrorPattern(errorMessage);

    // Increment pattern count
    const currentCount = this.errorPatterns.get(pattern) || 0;
    this.errorPatterns.set(pattern, currentCount + 1);

    if (this.config.debug) {
      console.log(`[Orchestrator Mentorship] Error pattern tracked: "${pattern}" (count: ${currentCount + 1})`);
    }
  }

  /**
   * Extract error pattern from error message
   */
  private extractErrorPattern(errorMessage: string): string {
    // Simple pattern extraction: take first 100 chars and normalize
    const normalized = errorMessage
      .substring(0, 100)
      .replace(/[0-9]+/g, 'N') // Replace numbers with N
      .replace(/['"]/g, '') // Remove quotes
      .toLowerCase();
    return normalized;
  }

  /**
   * Check if pattern detection should trigger (Phase 2)
   */
  private shouldTriggerPatternDetection(errorPattern: string): boolean {
    if (!this.config.reactiveMentorship?.enabled || !this.config.reactiveMentorship?.patternDetection) {
      return false;
    }

    const threshold = this.config.reactiveMentorship.patternThreshold || 3;
    const count = this.errorPatterns.get(errorPattern) || 0;

    return count >= threshold;
  }

  /**
   * Handle pattern detection (Phase 2)
   */
  private async handlePatternDetection(errorPattern: string): Promise<void> {
    const occurrences = this.errorPatterns.get(errorPattern) || 0;

    if (this.config.debug) {
      console.log(`[Orchestrator Mentorship] Pattern detected: "${errorPattern}" (${occurrences} occurrences)`);
    }

    try {
      const guidance = await this.helperMiddleware.generatePatternDetectionGuidance({
        errorPattern,
        occurrences,
        recentHistory: this.messageHistory,
        helperModelId: this.config.reactiveMentorship?.helperModelId
      });

      await this.injectThinkingBlock(guidance, 'error');

      if (this.config.debug) console.log(`[Orchestrator Mentorship] Pattern detection guidance injected`);

      // Reset pattern count after intervention
      this.errorPatterns.set(errorPattern, 0);
    } catch (error: any) {
      console.error(`[Orchestrator Mentorship] Failed to generate pattern detection guidance:`, error.message);
    }
  }

  /**
   * Check if interleaved thinking should be provided (Phase 2)
   */
  private shouldUseInterleavedThinking(): boolean {
    if (!this.config.reactiveMentorship?.enabled || !this.config.reactiveMentorship?.interleavedThinking) {
      return false;
    }

    const model = this.getModel(this.currentModelId);

    // Only provide mentorship thinking for models WITHOUT native interleaved thinking
    //
    // Model Categories:
    // 1. Interleaved thinking models (grok-code-fast-1, claude reasoning, kimi-k2-thinking, minimax-m2):
    //    - Think WHILE acting (tool calls during reasoning)
    //    - NO mentorship needed [ERROR]
    //
    // 2. Upfront thinking models (o1, o3):
    //    - Think BEFORE acting (all reasoning upfront)
    //    - YES mentorship helpful [OK] (can't think during tool use)
    //
    // 3. Non-thinking models (gpt-4, gemini-flash, claude-haiku):
    //    - No native reasoning
    //    - YES mentorship helpful [OK]

    const hasInterleavedThinking = model.reasoning?.supported === true
                                  && model.reasoning?.pattern === 'interleaved';

    return !hasInterleavedThinking;
  }

  /**
   * Handle interleaved thinking (Phase 2)
   */
  private async handleInterleavedThinking(userMessage: string): Promise<void> {
    if (this.config.debug) {
      console.log(`[Orchestrator Mentorship] Providing interleaved thinking for non-reasoning model`);
    }

    try {
      const guidance = await this.helperMiddleware.generateInterleavedThinking({
        userMessage,
        recentHistory: this.messageHistory,
        helperModelId: this.config.reactiveMentorship?.helperModelId
      });

      await this.injectThinkingBlock(guidance, 'interleaved');

      if (this.config.debug) console.log(`[Orchestrator Mentorship] Interleaved thinking injected`);
    } catch (error: any) {
      console.error(`[Orchestrator Mentorship] Failed to generate interleaved thinking:`, error.message);
    }
  }

  /**
   * Extract file paths from Read tool results in message history
   * Used by Active Discovery to know what files have been read
   */
  private extractFilesReadFromHistory(history: Message[]): string[] {
    const files: string[] = [];
    for (const msg of history) {
      if (msg.type === 'user' && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content as any[]) {
          if (block.type === 'tool_result' && block.tool_name === 'Read' && !block.is_error) {
            if (block.metadata?.file_path) {
              files.push(block.metadata.file_path);
            }
          }
        }
      }
    }
    return [...new Set(files)]; // deduplicate
  }

  /**
   * Get model by ID (Phase 2.1 - Real ModelRegistry)
   */
  private getModel(modelId: string): ModelConfig {
    // The registry resolves back-compat aliases internally (e.g. deepseek-chat →
    // deepseek-v4-flash) and throws on a genuine miss.
    const model = this.modelRegistry.getModel(modelId);
    if (!model) {
      throw new Error(
        `Model not found: ${modelId}. Available models: ${this.modelRegistry.listModels().join(', ')}`
      );
    }
    return model;
  }

  /**
   * Validate and repair canonical messages for API consistency
   *
   * Claude API requires every tool_use block to have a corresponding tool_result
   * in the immediately following message. This can break if a crash occurs between
   * saving the assistant message and saving the tool_result.
   *
   * This method adds synthetic error tool_results for any orphaned tool_use blocks.
   */
  private validateAndRepairMessages(messages: CanonicalMessage[]): CanonicalMessage[] {
    const repaired: CanonicalMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      repaired.push(msg);

      // Check if this is an assistant message with tool_use blocks
      if (msg.role === 'assistant') {
        const toolUseBlocks = msg.content.filter(
          (block: any) => block.type === 'tool_use'
        );

        if (toolUseBlocks.length > 0) {
          // CRITICAL FIX: Look at ALL consecutive user messages after this assistant message
          // Each tool_result might be in a separate user message (orchestrator saves them individually)
          // We need to collect ALL tool_result IDs from ALL consecutive user messages
          const toolResultIds = new Set<string>();
          let j = i + 1;

          while (j < messages.length && messages[j]!.role === 'user') {
            const userMsg = messages[j]!;
            for (const block of userMsg.content) {
              if ((block as any).type === 'tool_result') {
                const toolResult = (block as any).toolResult || block;
                toolResultIds.add(toolResult.tool_use_id);
              }
            }
            j++;
          }

          // Find orphaned tool_use blocks (no matching tool_result in ANY following user message)
          const orphanedToolUses = toolUseBlocks.filter((block: any) => {
            const toolUse = block.toolUse || block;
            return !toolResultIds.has(toolUse.id);
          });

          // If there are orphaned tool_use blocks, add synthetic tool_results
          if (orphanedToolUses.length > 0) {
            // Debug: Log what's happening with tool_use/tool_result matching
            if (process.env.DEBUG === 'true') {
              console.warn(
                `[Orchestrator] Repairing ${orphanedToolUses.length} orphaned tool_use blocks (crash recovery)`
              );
              console.log('[DEBUG Repair] Tool use IDs:', toolUseBlocks.map((b: any) => (b.toolUse || b).id));
              console.log('[DEBUG Repair] Tool result IDs found:', Array.from(toolResultIds));
              if (process.env.DEBUG === 'true') console.log('[DEBUG Repair] Consecutive user messages scanned:', j - i - 1);
            }

            const syntheticResults: any[] = orphanedToolUses.map((block: any) => {
              const toolUse = block.toolUse || block;

              // R30: Check durable store for a completed sub-agent result
              // (ESC-abort orphan recovery — the sub-agent finished but
              // the parent turn was interrupted before folding back)
              const persisted = this.currentSessionId
                ? SubAgentProcessManager.loadPersistedResult(
                    this.currentSessionId,
                    toolUse.id,
                    this.config.projectPath,
                  )
                : null;

              if (persisted) {
                if (process.env.DEBUG === 'true') {
                  console.log(`[Orchestrator] R30 recovery: found persisted sub-agent result for tool_use_id=${toolUse.id}`);
                }
                const formatted = this.formatSubAgentResultForLLM(persisted);
                return {
                  type: 'tool_result',
                  toolResult: {
                    tool_use_id: toolUse.id,
                    content: formatted,
                    is_error: persisted.status !== 'completed',
                  }
                };
              }

              return {
                type: 'tool_result',
                toolResult: {
                  tool_use_id: toolUse.id,
                  content: `Tool execution was interrupted (session crash recovery). Tool "${toolUse.name}" was not executed.`,
                  is_error: true
                }
              };
            });

            // If next message exists and is user, add to it
            // Otherwise create a new user message with tool_results
            const nextMsg = messages[i + 1];
            if (nextMsg && nextMsg.role === 'user') {
              // Prepend synthetic results to the existing user message
              nextMsg.content = [...syntheticResults, ...nextMsg.content];
            } else {
              // Insert synthetic user message with tool_results
              // Round 6 (Opus self-audit finding): `synthetic_repair_${Date.now()}`
              // collides at ms granularity under parallel sub-agent dispatch.
              // The canonicalConversionCache is uuid-keyed, so colliding synthetic
              // uuids would silently alias entries. Use uuidv4 instead.
              const syntheticMessage: CanonicalMessage = {
                uuid: `synthetic_repair_${uuidv4()}`,
                timestamp: new Date().toISOString(),
                timeline: msg.timeline,
                role: 'user',
                type: 'tool_response',
                content: syntheticResults,
                model: msg.model
              };
              repaired.push(syntheticMessage);
            }
          }
        }
      }
    }

    return repaired;
  }

  /**
   * Round 5 (parallel-bench output): per-uuid canonical conversion cache.
   *
   * `convertToCanonicalMessages` runs from 4 call sites (sendMessage initial,
   * sendMessage continuation, streamMessage initial, streamMessage
   * continuation), each pass rebuilding canonical blocks for every message
   * in history. Messages 0..N-2 are immutable (persisted append-only JSONL,
   * uuid-keyed) — their canonical form never changes, so we cache by uuid.
   *
   * The LAST message (N-1) is intentionally excluded from the cache. Three
   * reasons:
   *   1. Last message can be substituted with an injected-content variant
   *      (see `userMessageForApi`) carrying per-turn `cache_control` markers
   *      that differ from the persisted message.
   *   2. Budget/diversity signals are appended in-place to the trailing
   *      tool_result block between tool iterations.
   *   3. The orphan-repair pass below may mutate content when it prepends
   *      synthetic tool_results.
   *
   * Repair always runs on the merged array — never cached past repair, since
   * orphan detection needs full-history visibility.
   */
  private canonicalConversionCache = new Map<string, CanonicalMessage>();

  /**
   * Convert Message[] to CanonicalMessage[]
   *
   * Also validates and repairs the message history to handle crash recovery scenarios
   * where tool_use blocks might be orphaned without matching tool_results.
   */
  private convertToCanonicalMessages(messages: Message[]): CanonicalMessage[] {
    const tailIdx = messages.length - 1;
    const converted = messages.map((msg, i) => {
      // Tail is recomputed every call (see cache doc-comment above).
      if (i === tailIdx) return this.convertSingleMessage(msg);
      // No uuid → can't cache; fall through to fresh compute.
      if (!msg.uuid) return this.convertSingleMessage(msg);
      const cached = this.canonicalConversionCache.get(msg.uuid);
      if (cached) {
        // Shallow-clone the cached wrapper so the downstream repair pass
        // (line 5775) can reassign `.content` in place without poisoning
        // the cache. The `content` array reference itself stays shared —
        // repair never mutates individual blocks, only swaps the array.
        return { ...cached };
      }
      const fresh = this.convertSingleMessage(msg);
      this.canonicalConversionCache.set(msg.uuid, fresh);
      // Return a shallow clone of the freshly-cached object for the same
      // reason — repair on this call must not affect the cache entry.
      return { ...fresh };
    });

    // Validate and repair any orphaned tool_use blocks (crash recovery)
    return this.validateAndRepairMessages(converted);
  }

  /**
   * Pure conversion of a single Message to its CanonicalMessage form.
   * Extracted from the original `.map(...)` body so both the cache hit/miss
   * paths and the always-recompute tail path call the same code.
   */
  private convertSingleMessage(msg: Message): CanonicalMessage {
      // Extract content from message structure
      const content = msg.type === 'user' || msg.type === 'assistant'
        ? (msg as any).message.content
        : (msg as any).content;

      // Ensure content is array of blocks, converting ContentBlock to CanonicalContentBlock
      const contentBlocks = typeof content === 'string'
        ? [{ type: 'text' as const, text: content }]
        : Array.isArray(content)
          ? content.map(block => {
              if (typeof block === 'string') {
                return { type: 'text' as const, text: block };
              }
              // Convert ContentBlock to CanonicalContentBlock
              if (block.type === 'text') {
                // #29: preserve cache_control breakpoint marker if present.
                // SystemMessageMiddleware sets this on the last prepend
                // reminder for Anthropic/XAI providers; stripping it here
                // would silently defeat prompt caching across requests.
                const out: any = { type: 'text' as const, text: block.text };
                if ((block as any).cache_control) {
                  out.cache_control = (block as any).cache_control;
                }
                return out;
              } else if (block.type === 'tool_use') {
                // Handle both flat (ContentBlock) and nested (CanonicalContentBlock) structures
                // This is needed because Message.content can contain either structure depending
                // on how the message was created.
                // R19c: MUST preserve `metadata` — adapters store provider-
                // specific round-trip data here (e.g. Gemini 3 thoughtSignature,
                // OpenAI Responses call_id, source provider). Dropping it broke
                // Gemini 3 multi-turn tool calling with "missing thought_signature".
                const toolUseData: any = 'toolUse' in block && block.toolUse
                  ? {  // Already CanonicalContentBlock with nested toolUse
                      id: block.toolUse.id,
                      name: block.toolUse.name,
                      input: block.toolUse.input,
                      ...(block.toolUse.metadata ? { metadata: block.toolUse.metadata } : {})
                    }
                  : {  // ContentBlock with flat structure
                      id: (block as any).id,
                      name: (block as any).name,
                      input: (block as any).input,
                      ...((block as any).metadata ? { metadata: (block as any).metadata } : {})
                    };

                return {
                  type: 'tool_use' as const,
                  toolUse: toolUseData
                };
              } else if (block.type === 'tool_result') {
                // Handle both flat (ContentBlock) and nested (CanonicalContentBlock) structures
                // R19c: same metadata-preservation reasoning as tool_use. Gemini
                // tool_result needs metadata.functionName for the functionResponse
                // name field — without it, the adapter emits "unknown" and the
                // model can't correlate the response to its call. tool_name lives
                // on the flat block at construction time (see orchestrator
                // line ~1359); hoist it into metadata.functionName so adapters
                // that need it (GenerateContentAPIAdapter) can read it.
                const flatToolName = (block as any).tool_name as string | undefined;
                const nestedMeta = ('toolResult' in block && block.toolResult)
                  ? block.toolResult.metadata
                  : (block as any).metadata;
                const mergedMeta = (nestedMeta || flatToolName)
                  ? { ...(nestedMeta || {}), ...(flatToolName && !(nestedMeta as any)?.functionName ? { functionName: flatToolName } : {}) }
                  : undefined;
                const toolResultData: any = 'toolResult' in block && block.toolResult
                  ? {  // Already CanonicalContentBlock with nested toolResult
                      tool_use_id: block.toolResult.tool_use_id,
                      content: block.toolResult.content,
                      is_error: block.toolResult.is_error,
                      ...(mergedMeta ? { metadata: mergedMeta } : {})
                    }
                  : {  // ContentBlock with flat structure
                      tool_use_id: (block as any).tool_use_id,
                      content: (block as any).content,
                      is_error: (block as any).is_error,
                      ...(mergedMeta ? { metadata: mergedMeta } : {})
                    };

                return {
                  type: 'tool_result' as const,
                  toolResult: toolResultData
                };
              } else if (block.type === 'thinking') {
                // Phase 2.8: Preserve thinking blocks during history conversion
                // Critical fix: thinking blocks were being stringified into text
                // IMPORTANT: Must preserve signature for Claude extended thinking continuations
                // Without signature, adapter filters out thinking blocks and Claude API errors:
                // "Expected thinking or redacted_thinking, but found tool_use"
                //
                // #19 (2026-05-11): Also preserve `thinkingMetadata` so the
                // adapter's source-aware drop-on-missing-signature logic
                // (MessagesAPIAdapter, #16) sees `source === 'extended'`.
                // Without this, in-memory continuations end up classified
                // as native and the signature-less block is sent to
                // Anthropic, which rejects with `thinking.signature:
                // Field required`.
                const thinkingBlock: any = {
                  type: 'thinking' as const,
                  thinking: (block as any).thinking || ''
                };
                // Preserve signature if present (required for Claude continuations)
                if ((block as any).signature) {
                  thinkingBlock.signature = (block as any).signature;
                }
                // Preserve source classification so the adapter can drop
                // signature-less extended-thinking blocks correctly.
                if ((block as any).thinkingMetadata) {
                  thinkingBlock.thinkingMetadata = (block as any).thinkingMetadata;
                }
                return thinkingBlock;
              } else if (block.type === 'redacted_thinking') {
                // XAI grok-4/4.1 encrypted reasoning — preserve opaquely
                return {
                  type: 'redacted_thinking' as const,
                  data: (block as any).data || ''
                };
              }
              return { type: 'text' as const, text: JSON.stringify(block) };
            })
          : [{ type: 'text' as const, text: JSON.stringify(content) }];

      return {
        uuid: msg.uuid,
        timestamp: msg.timestamp,
        timeline: msg.timeline || {
          sessionId: '',
          conversationId: '',
          turnNumber: 0
        },
        role: msg.type === 'user' ? 'user' : msg.type === 'assistant' ? 'assistant' : 'system',
        type: msg.type === 'user' ? 'text' : msg.type === 'assistant' ? 'text' : 'text',
        content: contentBlocks,
        model: msg.model
      } as CanonicalMessage;
  }

  // ============================================
  // APPROVAL MODE API
  // ============================================

  /**
   * Get current approval mode settings
   *
   * @returns Current approval mode configuration
   */
  getApprovalMode(): { autoApproveActions: boolean } {
    return { ...this.approvalMode };
  }

  /**
   * Set approval mode for session
   *
   * @param mode - Approval mode configuration
   */
  setApprovalMode(mode: { autoApproveActions: boolean }): void {
    this.approvalMode = mode;
    if (this.config.debug) {
      console.log(
        `[Orchestrator] Approval mode updated: auto approve actions ${mode.autoApproveActions ? 'ON' : 'OFF'}`
      );
    }
  }

  /**
   * Enable YOLO mode - auto-approve ALL operations (white/gray/blacklist)
   *
   * WARNING: This bypasses all security checks. Use with caution.
   */
  async enableYoloMode(): Promise<void> {
    if (!this.permissionsMiddleware) {
      throw new Error('Permissions middleware not available');
    }

    // Import and create AutoApproveHandler
    const { AutoApproveHandler } = await import('../middleware/permissions/AutoApproveHandler.js');
    const autoApprover = new AutoApproveHandler({ enableLogging: this.config.debug || false });

    // Swap the approval handler
    this.permissionsMiddleware.setApprovalHandler(autoApprover);

    if (this.config.debug) {
      console.log('[Orchestrator]  YOLO MODE ENABLED - Auto-approving ALL operations');
    }
  }

  /**
   * Disable YOLO mode - return to interactive approval
   */
  async disableYoloMode(): Promise<void> {
    if (!this.permissionsMiddleware) {
      throw new Error('Permissions middleware not available');
    }

    // Import and create CLIApprovalHandler
    const { CLIApprovalHandler } = await import('../middleware/permissions/CLIApprovalHandler.js');
    const cliApprover = new CLIApprovalHandler({
      showToolInput: true
      // No timeout - wait indefinitely for user to return and respond
    });

    // Swap back to interactive approval
    this.permissionsMiddleware.setApprovalHandler(cliApprover);

    if (this.config.debug) {
      console.log('[Orchestrator]   YOLO MODE DISABLED - Interactive approval restored');
    }
  }

  /**
   * Check if YOLO mode is active
   */
  isYoloModeActive(): boolean {
    if (!this.permissionsMiddleware) {
      return false;
    }

    const handler = this.permissionsMiddleware.getApprovalHandler();
    // Check if it's an AutoApproveHandler (YOLO mode)
    return handler?.constructor.name === 'AutoApproveHandler';
  }

  updateRuntimeConfig(updates: Partial<Pick<OrchestratorConfig,
    'debug' | 'autoCompact' | 'useHelperModels' | 'reactiveMentorship' | 'loopControl' | 'modelRouter'
  >>): void {
    if (updates.debug !== undefined) {
      this.config.debug = updates.debug;
      process.env.DEBUG = updates.debug ? 'true' : 'false';
    }
    if (updates.autoCompact !== undefined) {
      this.config.autoCompact = updates.autoCompact;
    }
    if (updates.useHelperModels !== undefined) {
      this.config.useHelperModels = updates.useHelperModels;
    }
    if (updates.reactiveMentorship !== undefined) {
      this.config.reactiveMentorship = {
        ...this.config.reactiveMentorship,
        ...updates.reactiveMentorship,
      } as OrchestratorConfig['reactiveMentorship'];
    }
    if (updates.loopControl !== undefined) {
      this.config.loopControl = {
        ...this.config.loopControl,
        ...updates.loopControl,
      };
    }
    if (updates.modelRouter !== undefined) {
      this.config.modelRouter = {
        ...this.config.modelRouter,
        ...updates.modelRouter,
      } as OrchestratorConfig['modelRouter'];
    }
  }

  /**
   * Set a custom approval handler for tool permissions
   *
   * This allows UI frameworks (like React/Ink) to provide their own
   * approval dialog implementation instead of using the default CLI handler.
   *
   * @param handler - Custom ApprovalHandler implementation
   */
  setApprovalHandler(handler: ApprovalHandler): void {
    if (this.permissionsMiddleware) {
      this.permissionsMiddleware.setApprovalHandler(handler);
      if (this.config.debug) {
        console.log('[Orchestrator] Custom approval handler set');
      }
    }
  }

  /**
   * Get the current approval handler
   */
  getApprovalHandler(): ApprovalHandler | undefined {
    return this.permissionsMiddleware?.getApprovalHandler();
  }

  /**
   * Set sub-agent event callback for real-time UI updates.
   * This allows UI frameworks (like React/Ink) to display sub-agent progress.
   *
   * @param callback - Function to receive sub-agent events
   */
  setSubAgentEventCallback(callback: SubAgentEventCallback): void {
    this.config.onSubAgentEvent = callback;
    // Callback is read dynamically when events are emitted,
    // so just updating the config is sufficient
    if (this.config.debug) {
      console.log('[Orchestrator] Sub-agent event callback set');
    }
  }

  /**
   * Get all registered permission policies
   *
   * @returns Array of registered policies
   */
  getPolicies(): ReadonlyArray<PermissionPolicy> {
    if (!this.permissionsMiddleware) {
      return [];
    }
    return this.permissionsMiddleware.getPolicies();
  }

  /**
   * Get audit log for current session or specific session
   *
   * @param sessionId - Optional session ID (defaults to current session)
   * @returns Array of audit entries
   */
  getAuditLog(sessionId?: string): PermissionAuditEntry[] {
    if (!this.permissionsMiddleware) {
      return [];
    }
    const sid = sessionId || this.currentSessionId;
    return this.permissionsMiddleware.getAuditLog(sid);
  }

  /**
   * Get audit statistics
   *
   * @returns Audit statistics or null if not available
   */
  async getAuditStatistics() {
    if (!this.permissionsMiddleware) {
      return null;
    }
    return await this.permissionsMiddleware.getStatistics();
  }

  /**
   * Get all denied operations across all sessions
   *
   * @returns Array of denied operations
   */
  async getAllDeniedOperations(): Promise<PermissionAuditEntry[]> {
    if (!this.permissionsMiddleware) {
      return [];
    }
    return await this.permissionsMiddleware.getAllDeniedOperations();
  }

  /**
   * Register a new permission policy
   *
   * @param policy - Policy to register
   */
  registerPolicy(policy: PermissionPolicy): void {
    if (!this.permissionsMiddleware) {
      throw new Error('Permissions middleware not available');
    }
    this.permissionsMiddleware.registerPolicy(policy);
    if (this.config.debug) {
      console.log(`[Orchestrator] Registered policy: ${policy.name}`);
    }
  }

  /**
   * Unregister a permission policy
   *
   * @param policyName - Name of policy to unregister
   * @returns True if policy was found and removed
   */
  unregisterPolicy(policyName: string): boolean {
    if (!this.permissionsMiddleware) {
      return false;
    }
    const result = this.permissionsMiddleware.unregisterPolicy(policyName);
    if (this.config.debug && result) {
      console.log(`[Orchestrator] Unregistered policy: ${policyName}`);
    }
    return result;
  }

  /**
   * Inject the per-turn "Repository State" harness-note (git branch / uncommitted
   * changes / recent commits + cross-agent staleness). Fires EVERY turn (git
   * state is turn-varying), unlike the turn-0-only MCP/command announcements.
   * Cache-safe: unshifted into the ephemeral user-turn content (uncached tail).
   */
  private injectRepoStateNote(injectedContent: unknown): void {
    if (!Array.isArray(injectedContent)) return;
    const gitRoot =
      process.env.PROJECT_ROOT ||
      this.config.projectPath ||
      this.config.workingDirectory ||
      process.cwd();
    const note = this.systemReminderInjector.buildGitContextSection(gitRoot);
    if (note) (injectedContent as any[]).unshift({ type: 'text', text: note });
  }

  /**
   * Inject the PM delegation hint for the auto-research subagent feature
   * (AUTORESEARCH_AGENTS). No-op when off or inside a subagent — the injector gates it.
   * Keeps the main model a clean PM: it learns it can delegate, not the tool surface.
   */
  private injectAutoResearchCapability(injectedContent: unknown): void {
    if (!Array.isArray(injectedContent)) return;
    const note = this.systemReminderInjector.buildAutoResearchCapabilitySection();
    if (note) (injectedContent as any[]).unshift({ type: 'text', text: note });
  }

  private buildDeferredToolAnnouncement(convention: 'snake_case' | 'PascalCase'): string | null {
    // Source from the SAME superset the SearchTools index uses — toolFactory PLUS the
    // separately-gathered MCP-management and context tools — or the harness-note never
    // tells the model that deferred setup tools (InitMcpConfig, InitCortexContext) exist.
    const allDiscoverable = [
      ...toolFactory.getAllTools(),
      ...this.getMcpManagementTools(),
      ...this.getContextManagementTools(),
    ];
    const deferred = this.toolFilter.getDeferredTools(allDiscoverable);
    if (deferred.length === 0) return null;

    const namingHandler = new ToolNamingHandler();
    const convert = (n: string) => namingHandler.convertName(n, convention);

    const TOOL_GROUPS: Record<string, string[]> = {
      'Session & History': [
        'ListSessions', 'LoadSession', 'SearchConversationHistory',
        'GetConversationSegment', 'ListCompactionBoundaries', 'RequestHistoricalContext',
      ],
      'Sandbox & Artifacts': [
        'CreateArtifactTool', 'InteractWithSandbox', 'ModifySandbox',
        'InspectSandbox', 'StopSandbox', 'SandboxTransfer',
      ],
      'Development': [
        'WorkspaceManager', 'PRAgent', 'TmuxSession', 'CodeExecute', 'NotebookEdit',
      ],
      'Workflow': [
        'TodoCreate', 'TodoUpdate', 'TodoList', 'ExitPlanMode',
        'AskUserQuestion', 'SlashCommand', 'Skill', 'EndTurn',
      ],
      'Web & Browse': [
        'WebSearch', 'WebFetch', 'Browse',
      ],
      'MCP Servers': [
        'InitMcpConfig', 'EnableMcpServer', 'DisableMcpServer', 'ConfigureMcpServer',
        'GetMcpConfig', 'ListAvailableMcpServers', 'SearchMcpServers',
      ],
      'Project Context': [
        'InitCortexContext',
      ],
    };

    const deferredSet = new Set(deferred.map(d => d.name));
    const descMap = new Map(deferred.map(d => [d.name, d.description]));
    const listed = new Set<string>();
    const lines: string[] = [];

    for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
      const groupTools = tools.filter(t => deferredSet.has(t));
      if (groupTools.length === 0) continue;
      lines.push(`\n${group}:`);
      for (const t of groupTools) {
        const desc = descMap.get(t) ?? '';
        const firstSentence = (desc.split('.')[0] ?? '').trim();
        lines.push(`- ${convert(t)} — ${firstSentence}`);
        listed.add(t);
      }
    }

    const ungrouped = deferred.filter(d => !listed.has(d.name));
    if (ungrouped.length > 0) {
      lines.push('\nOther:');
      for (const d of ungrouped) {
        const firstSentence = (d.description.split('.')[0] ?? '').trim();
        lines.push(`- ${convert(d.name)} — ${firstSentence}`);
      }
    }

    return `<harness-note source="automated-harness" from-user="false">\nThe following is automated context injected by the harness — NOT a message from the user. The tools below are available but their schemas are NOT loaded yet. To use any of them, call search_tools first to load the schema, then call the tool.\n${lines.join('\n')}\n</harness-note>`;
  }
}
