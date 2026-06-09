/**
 * Orchestrator Factory - Wave 3 Integration
 *
 * Creates CortexOrchestrator with all dependencies and middleware properly wired up.
 * This implements dependency injection for the v4.0.0 middleware architecture.
 *
 * @version 4.0.0
 * @since Wave 3 Integration
 */

import { CortexOrchestrator, type OrchestratorConfig } from './CortexOrchestrator.js';
import { AdapterRegistry } from '../adapters/AdapterRegistry.js';
import { GatewayTranslationLayer } from '../adapters/GatewayTranslationLayer.js';
import { ModularModelRegistry } from '../models/registry/ModularModelRegistry.js';
import { ModelAliasResolver } from '../models/registry/ModelAliasResolver.js';
import { HelperModelMiddleware } from '../middleware/HelperModelMiddleware.js';
import { StoredCompactionManager } from '../conversation/StoredCompactionManager.js';
import { ContextBudgetManager } from '../conversation/ContextBudgetManager.js';
import { JSONLHistoryStore } from '../session/JSONLHistoryStore.js';
import { HistoricalContextService } from '../tools/historical/HistoricalContextService.js';
import type { ExecutorConfig } from '@nexus-cortex/types';
import { createExecutorRegistry, FileReadTracker } from '@nexus-cortex/executors';
import { McpConfigManager } from '../mcp/McpConfigManager.js';
import { McpServerRegistry } from '../mcp/McpServerRegistry.js';
import { McpClientManager } from '../mcp/index.js';
import { APIClient } from './APIClient.js';
import { SystemReminderInjector } from '../system-messages/SystemReminderInjector.js';
import { SystemMessageLoader } from '../system-messages/SystemMessageLoader.js';
import { resolveContext } from '../utils/ContextResolver.js';

// Wave 3: Middleware imports
import { ErrorClassificationMiddleware } from '../middleware/ErrorClassificationMiddleware.js';
import { RetryMiddleware } from '../middleware/RetryMiddleware.js';
import { PermissionsMiddleware } from '../middleware/PermissionsMiddleware.js';
import { SystemMessageMiddleware } from '../middleware/SystemMessageMiddleware.js';
import { MentorshipMiddleware } from '../middleware/MentorshipMiddleware.js';
import type { RetryOptions } from '../middleware/contracts/MiddlewareContracts.js';

// Wave 3: Permission policy imports
import { WhitelistPolicy } from '../middleware/permissions/WhitelistPolicy.js';
import { FileOperationPolicy } from '../middleware/permissions/FileOperationPolicy.js';
import { BashCommandPolicy } from '../middleware/permissions/BashCommandPolicy.js';
import { CLIApprovalHandler } from '../middleware/permissions/CLIApprovalHandler.js';
import { AutoApproveHandler } from '../middleware/permissions/AutoApproveHandler.js';
import type { PermissionPolicy } from '../middleware/contracts/MiddlewareContracts.js';
import { defaultPolicies } from '../middleware/permissions/DefaultPolicies.js';
import { PermissionConfigLoader } from '../middleware/permissions/PermissionConfigLoader.js';
import { resolvePermissionProfilePath } from '../middleware/permissions/profilePath.js';

/**
 * Middleware configuration options
 *
 * @since Wave 3
 */
export interface MiddlewareConfig {
  /** Enable permissions system (default: true) */
  enablePermissions?: boolean;

  /** Permission mode: interactive (CLI prompts), auto (YOLO mode), disabled */
  permissionMode?: 'interactive' | 'auto' | 'disabled';

  /** Custom permission policies (default: createDefaultPolicies) */
  permissionPolicies?: PermissionPolicy[];

  /** Retry configuration */
  retryOptions?: Partial<RetryOptions>;

  /**
   * Callbacks for pausing/resuming custom input handling during approval dialogs.
   * Use this when you have a custom input system (e.g., persistent input with scroll regions)
   * that needs to be temporarily paused while the approval dialog is shown.
   */
  inputHandlerCallbacks?: {
    /** Called before showing approval dialog - pause custom input handling */
    onBeforeApproval: () => void;
    /** Called after approval dialog is dismissed - resume custom input handling */
    onAfterApproval: () => void;
  };

  /**
   * Callback to render tool-specific previews before approval prompts.
   * Use this to show diffs for Edit tools, file content for Write tools, etc.
   * Called with the full approval request so you can render based on toolName and toolInput.
   */
  previewRenderer?: (request: { toolName: string; toolInput: any; reason: string; timestamp: Date }) => void;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1
};

/**
 * Create default permission policies based on config
 *
 * Uses the new 3-tier system (Whitelist/Graylist/Blacklist)
 * with auto-approve actions support.
 *
 * If permissionProfile is specified, loads policies from JSON file.
 * Otherwise falls back to hardcoded default policies.
 */
interface ResolvedPermissionsConfig {
  policies: PermissionPolicy[];
  defaultPolicy: 'allow' | 'deny';
}

async function createDefaultPolicies(config: OrchestratorConfig): Promise<ResolvedPermissionsConfig> {
  // If permissionProfile is specified, try to load from JSON file. The path
  // resolver tries the dotted form (.cortex/permissions.<profile>.json — the
  // form documented in CLAUDE.md) first, falling back to the subdirectory
  // form for backward compat.
  if (config.permissionProfile && config.permissionProfile !== 'custom') {
    const profileName = config.permissionProfile as 'dev' | 'test' | 'prod';
    if (!['dev', 'test', 'prod'].includes(profileName)) {
      console.warn(`[OrchestratorFactory] Unknown permission profile: ${config.permissionProfile}`);
    } else {
      const projectRoot = (config as any).projectPath || process.cwd();
      const profilePath = resolvePermissionProfilePath(profileName, projectRoot);

      if (profilePath) {
        try {
          const loader = new PermissionConfigLoader({
            throwOnError: false,
            enableLogging: config.debug || false,
          });

          const fileContent = await fsReadJson(profilePath);
          const policies = await loader.loadPoliciesFromFile(profilePath);
          const defaultPolicy: 'allow' | 'deny' =
            fileContent?.defaultPolicy === 'allow' ? 'allow' : 'deny';

          if (config.debug) {
            console.log(
              `[OrchestratorFactory] Loaded ${policies.length} policies from permission profile: ${profileName} (defaultPolicy: ${defaultPolicy}, path: ${profilePath})`,
            );
          }
          return { policies, defaultPolicy };
        } catch (error) {
          console.warn(`[OrchestratorFactory] Failed to load permission profile ${profileName}:`, error);
          console.warn('[OrchestratorFactory] Falling back to default policies');
        }
      } else if (config.debug) {
        console.log(
          `[OrchestratorFactory] No permission profile found for "${profileName}" under ${projectRoot}/.cortex/. Using defaults.`,
        );
      }
    }
  }

  // Fallback: hardcoded default policies use the safer 'deny' default.
  return { policies: defaultPolicies, defaultPolicy: 'deny' };
}

async function fsReadJson(filePath: string): Promise<any> {
  const { promises: fs } = await import('fs');
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Create an CortexOrchestrator with all dependencies properly injected
 *
 * This is the canonical way to create an orchestrator instance.
 *
 * @param config - Orchestrator configuration
 * @param middlewareConfig - Optional middleware configuration
 * @returns Configured orchestrator instance
 */
export async function createOrchestrator(
  config: OrchestratorConfig,
  middlewareConfig: MiddlewareConfig = {}
): Promise<CortexOrchestrator> {
  // Phase 4.0: Context-Aware Storage Resolution
  // If storageDir not explicitly set, use context-aware resolution
  let resolvedStorageDir: string;
  let resolvedContextRoot: string | undefined;

  if (!config.storageDir) {
    // Use context resolver to determine storage location based on launch directory
    const context = resolveContext({
      cwd: config.workingDirectory || process.cwd(),
      debug: config.debug
    });

    resolvedStorageDir = context.sessionsDir;
    resolvedContextRoot = context.contextRoot;

    if (config.debug) {
      console.log('[OrchestratorFactory] Context-aware storage resolution:');
      console.log(` Context level: ${context.contextLevel}`);
      console.log(` Context root: ${context.contextRoot}`);
      console.log(` Sessions: ${context.sessionsDir}`);
      console.log(` System messages: ${context.systemMessagesDir}`);
    }
  } else {
    // Use explicitly provided storageDir
    resolvedStorageDir = config.storageDir;
    if (config.debug) {
      console.log('[OrchestratorFactory] Using explicit storageDir:', resolvedStorageDir);
    }
  }

  // Auto-load reactiveMentorship from env if not explicitly provided
  // This ensures mentorship works regardless of how the orchestrator is created
  // (server, CLI, tests all benefit without needing to manually pass config)
  let mentorshipConfig = config.reactiveMentorship;
  if (!mentorshipConfig && process.env.MENTORSHIP_ENABLED === 'true') {
    mentorshipConfig = {
      enabled: true,
      triggerOnError: process.env.MENTORSHIP_TRIGGER_ON_ERROR === 'true',
      errorSeverityThreshold: (process.env.MENTORSHIP_ERROR_THRESHOLD as 'low' | 'medium' | 'high') || 'medium',
      enableKeywords: process.env.MENTORSHIP_KEYWORDS_ENABLED === 'true',
      customKeywords: process.env.MENTORSHIP_CUSTOM_KEYWORDS
        ? process.env.MENTORSHIP_CUSTOM_KEYWORDS.split(',').map(k => k.trim()).filter(k => k)
        : undefined,
      helperModelId: process.env.MENTORSHIP_HELPER_MODEL || undefined,
      turnBasedEnabled: process.env.MENTORSHIP_TURN_BASED_ENABLED === 'true',
      turnInterval: parseInt(process.env.MENTORSHIP_TURN_INTERVAL || '10'),
      interleavedThinking: process.env.MENTORSHIP_INTERLEAVED_THINKING === 'true',
      patternDetection: process.env.MENTORSHIP_PATTERN_DETECTION === 'true',
      patternThreshold: parseInt(process.env.MENTORSHIP_PATTERN_THRESHOLD || '3'),
      activeDiscovery: process.env.MENTORSHIP_ACTIVE_DISCOVERY === 'true'
    };

    if (config.debug) {
      console.log('[OrchestratorFactory] Auto-loaded reactiveMentorship config from environment');
    }
  }

  // Auto-load PTC settings from env if not explicitly provided
  if (config.enablePTC === undefined && process.env.ENABLE_PTC === 'true') {
    config.enablePTC = true;
  }
  if (config.enableLocalCodeExecution === undefined && process.env.ENABLE_LOCAL_CODE_EXECUTION === 'true') {
    config.enableLocalCodeExecution = true;
  }
  if (config.enableDeferredToolLoading === undefined && process.env.ENABLE_DEFERRED_TOOL_LOADING === 'true') {
    config.enableDeferredToolLoading = true;
  }

  // Auto-load model router config from env (recording is independent of routing)
  if (!config.modelRouter && (process.env.MODEL_ROUTER_ENABLED === 'true' || process.env.MODEL_ROUTER_RECORD === 'true')) {
    config.modelRouter = {
      enabled: process.env.MODEL_ROUTER_ENABLED === 'true',
      strategy: (process.env.MODEL_ROUTER_STRATEGY as 'auto' | 'matrix-only') || 'auto',
      autoRecord: process.env.MODEL_ROUTER_RECORD !== 'false',
    };
    if (config.debug) {
      console.log('[OrchestratorFactory] Auto-loaded modelRouter config from environment:', config.modelRouter);
    }
  }
  // Permission profiles are ONLY loaded when explicitly passed via config.
  // No auto-selection from NODE_ENV — the hardcoded 3-tier DefaultPolicies
  // (whitelist/graylist/blacklist) provide CC-like behavior out of the box.


  // Normalize config
  const normalizedConfig: OrchestratorConfig = {
    autoCompact: true,
    useHelperModels: true,
    enableTimeline: true,
    debug: false,
    storageDir: resolvedStorageDir,
    ...config,
    reactiveMentorship: mentorshipConfig
  };

  // Auto-load loop control from env if not explicitly provided
  if (!normalizedConfig.loopControl) {
    const envIterations = parseInt(process.env.MAX_TOOL_ITERATIONS || '', 10);
    const envErrors = parseInt(process.env.MAX_CONSECUTIVE_ERRORS || '', 10);
    const envBudgetSoft = parseInt(process.env.TOOL_BUDGET_SOFT || '', 10);
    const envTimeout = parseInt(process.env.TOOL_TIMEOUT_MS || '', 10);
    const envRepetitions = parseInt(process.env.MAX_LOOP_REPETITIONS || '', 10);

    const hasAny = [envIterations, envErrors, envBudgetSoft, envTimeout, envRepetitions].some(v => !Number.isNaN(v));
    if (hasAny) {
      normalizedConfig.loopControl = {
        ...(Number.isNaN(envIterations) ? {} : { maxToolIterations: envIterations }),
        ...(Number.isNaN(envErrors) ? {} : { maxConsecutiveErrors: envErrors }),
        ...(Number.isNaN(envBudgetSoft) ? {} : { toolBudgetSoft: envBudgetSoft }),
        ...(Number.isNaN(envTimeout) ? {} : { toolTimeoutMs: envTimeout }),
        ...(Number.isNaN(envRepetitions) ? {} : { maxLoopRepetitions: envRepetitions }),
      };

      if (config.debug) {
        console.log('[OrchestratorFactory] Auto-loaded loopControl from environment:', normalizedConfig.loopControl);
      }
    }
  }

  // Phase 1.5 Week 1: Multi-Provider
  const adapterRegistry = new AdapterRegistry();
  const gatewayTranslation = new GatewayTranslationLayer(adapterRegistry);
  const modelRegistry = new ModularModelRegistry();
  const modelAliasResolver = new ModelAliasResolver();

  // Phase 1.5 Week 2: Context & Helpers
  const compactionManager = new StoredCompactionManager(normalizedConfig.storageDir!);
  const helperMiddleware = new HelperModelMiddleware({
    compactionManager: compactionManager,
    modelRegistry: modelRegistry // Enable mentorship to use ANY model from registry
    // timeline will be set when session is created
  });
  const contextBudgetManager = new ContextBudgetManager();

  // Phase 1.5 Week 3: Timeline & History
  const historyStore = new JSONLHistoryStore({
    baseDir: normalizedConfig.storageDir!
  });
  const historicalService = new HistoricalContextService(normalizedConfig.storageDir!);

  // Phase 2.5: Tool Execution
  const executorConfig: ExecutorConfig = {
    workingDirectory: normalizedConfig.workingDirectory || normalizedConfig.projectPath || process.cwd(),
    enableSandbox: normalizedConfig.enableSandbox ?? true,
    allowedCommands: normalizedConfig.allowedCommands || []
  };
  const executorRegistry = createExecutorRegistry(executorConfig);

  // Phase 2.9: MCP Integration
  const mcpConfigManager = new McpConfigManager(normalizedConfig.projectPath);
  const mcpRegistry = new McpServerRegistry();
  const mcpManager = normalizedConfig.enableMcp !== false
    ? new McpClientManager(normalizedConfig.debug || false)
    : undefined;

  // Late-bind MCP manager for tools that need direct MCP access (e.g., SandboxTransfer).
  // ExecutorConfig is passed by reference — tools see this mutation at execution time.
  (executorConfig as any).mcpManagerGetter = () => mcpManager;

  // Phase 2: Core Components
  // `__apiClientOverride` is a test-only escape hatch: integration tests inject a
  // scripted APIClient to drive the real orchestrator loop with a controlled
  // tool_use sequence (e.g. to exercise the progress-gated hard cap end-to-end).
  // Production never sets it.
  const apiClient: APIClient = (config as any).__apiClientOverride ?? new APIClient();
  const systemReminderInjector = new SystemReminderInjector();
  // Cross-agent staleness: surface read-then-externally-changed files in the
  // per-turn git-context note. FileReadTracker is an executors static; wiring
  // the callback here (the factory already imports executors) keeps the
  // orchestrator itself free of a direct executors dependency.
  systemReminderInjector.setStaleFilesProvider(() => FileReadTracker.getExternallyChangedFiles());

  // Create SystemMessageLoader - simplified direct file loading
  // Uses project path for .cortex/system-messages/ overrides
  const projectPath = resolvedContextRoot || normalizedConfig.projectPath;
  const systemMessageLoader = new SystemMessageLoader({
    projectPath,
    debug: normalizedConfig.debug || false
  });

  // Note: FileCheckpointManager is created in createSession() since it needs sessionId

  // ============================================
  // Wave 3: Create Middleware Components
  // ============================================

  // 1. ErrorClassificationMiddleware
  const errorClassifier = new ErrorClassificationMiddleware();

  // 2. RetryMiddleware with ErrorClassifier
  const retryOptions: RetryOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...middlewareConfig.retryOptions
  };
  const retryMiddleware = new RetryMiddleware(errorClassifier, retryOptions);

  // 3. PermissionsMiddleware (if enabled)
  let permissionsMiddleware: PermissionsMiddleware | undefined;
  let cliApprovalHandler: CLIApprovalHandler | null = null;
  const permissionMode = middlewareConfig.permissionMode || 'interactive';

  if (middlewareConfig.enablePermissions !== false && permissionMode !== 'disabled') {
    let policies: PermissionPolicy[];
    let defaultPolicy: 'allow' | 'deny';

    if (middlewareConfig.permissionPolicies) {
      // Explicit policies passed in — use 'deny' default (safer fallback).
      policies = middlewareConfig.permissionPolicies;
      defaultPolicy = 'deny';
    } else {
      const resolved = await createDefaultPolicies(normalizedConfig);
      policies = resolved.policies;
      defaultPolicy = resolved.defaultPolicy;
    }

    // Create appropriate approval handler based on mode
    let approvalHandler;
    if (permissionMode === 'auto') {
      // YOLO mode: Auto-approve all operations
      approvalHandler = new AutoApproveHandler({ enableLogging: normalizedConfig.debug || false });
    } else {
      // Interactive mode: CLI prompts with yes/no (wait indefinitely for user input)
      cliApprovalHandler = new CLIApprovalHandler({
        showToolInput: true
        // No timeout - wait indefinitely for user to return and respond
      });
      approvalHandler = cliApprovalHandler;
    }

    permissionsMiddleware = new PermissionsMiddleware({
      policies,
      approvalHandler,
      // Honor the JSON profile's defaultPolicy. YOLO short-circuits via
      // bypassAll regardless of this setting.
      defaultPolicy,
      // YOLO bypass — allows tools that hard-deny policies (e.g. an empty
      // whitelist with canApprove: false) cannot otherwise escape.
      bypassAll: permissionMode === 'auto',
      enableLogging: normalizedConfig.debug || false,
    });
  }

  // 4. SystemMessageMiddleware
  const systemMessageMiddleware = new SystemMessageMiddleware(
    systemMessageLoader,
    systemReminderInjector
  );

  // 5. MentorshipMiddleware
  const mentorshipMiddleware = new MentorshipMiddleware();

  // Create orchestrator with all dependencies + middleware injected
  const orchestrator = new CortexOrchestrator(
    adapterRegistry,
    gatewayTranslation,
    modelRegistry,
    modelAliasResolver,
    helperMiddleware,
    compactionManager,
    contextBudgetManager,
    historyStore,
    historicalService,
    executorRegistry,
    mcpConfigManager,
    mcpRegistry,
    mcpManager,
    apiClient,
    systemReminderInjector,
    systemMessageLoader,
    normalizedConfig,
    // Wave 3: Middleware components
    errorClassifier,
    retryMiddleware,
    permissionsMiddleware,
    systemMessageMiddleware,
    mentorshipMiddleware,
  );

  // Wire CLIApprovalHandler callbacks if in interactive mode
  if (cliApprovalHandler) {
    cliApprovalHandler.setApprovalModeCallbacks({
      onToggle: () => {
        const current = orchestrator.getApprovalMode();
        orchestrator.setApprovalMode({ autoApproveActions: !current.autoApproveActions });
      },
      getStatus: () => {
        return orchestrator.getApprovalMode().autoApproveActions;
      }
    });

    // Wire input handler callbacks for pausing/resuming custom input during approval dialogs
    if (middlewareConfig.inputHandlerCallbacks) {
      cliApprovalHandler.setInputHandlerCallbacks(middlewareConfig.inputHandlerCallbacks);
    }

    // Wire preview renderer for showing tool-specific previews before approval prompt
    if (middlewareConfig.previewRenderer) {
      cliApprovalHandler.setPreviewRenderer(middlewareConfig.previewRenderer);
    }
  }

  return orchestrator;
}

/**
 * Create a development-mode orchestrator with relaxed permissions
 *
 * @param config - Orchestrator configuration
 * @returns Orchestrator configured for development
 */
export async function createDevelopmentOrchestrator(config: OrchestratorConfig): Promise<CortexOrchestrator> {
  return await createOrchestrator(config, {
    enablePermissions: true,
    permissionPolicies: [
      // Permissive whitelist
      new WhitelistPolicy([]), // Empty = allow all
      // Still block dangerous operations
      new BashCommandPolicy({
        allowedCommands: [],
        blockedCommands: ['rm -rf /', 'sudo rm -rf'],
        requireApprovalForDangerous: false
      })
    ],
    // Faster retries for development
    retryOptions: {
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 5000
    }
  });
}

/**
 * Create a production-mode orchestrator with strict permissions
 *
 * @param config - Orchestrator configuration
 * @returns Orchestrator configured for production
 */
export async function createProductionOrchestrator(config: OrchestratorConfig): Promise<CortexOrchestrator> {
  return await createOrchestrator(config, {
    enablePermissions: true,
    permissionPolicies: [
      // Strict whitelist - only read operations
      new WhitelistPolicy(['read_file', 'list_files', 'grep', 'search_conversation_history']),
      // Very restrictive file access
      new FileOperationPolicy({
        allowedPaths: [`${config.projectPath}/public`],
        blockedPaths: [
          '/etc', '/root', '/sys', '/proc', '/.git', '/node_modules', '/.env',
          `${config.projectPath}/config`, `${config.projectPath}/secrets`
        ],
        requireApprovalForDelete: false
      }),
      // Block all bash commands
      new BashCommandPolicy({
        allowedCommands: [],
        blockedCommands: ['*'],
        requireApprovalForDangerous: false
      })
    ],
    // Production retry settings
    retryOptions: {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 60000
    }
  });
}

/**
 * Create a testing-mode orchestrator with no permissions
 *
 * @param config - Orchestrator configuration
 * @returns Orchestrator configured for testing
 */
export async function createTestingOrchestrator(config: OrchestratorConfig): Promise<CortexOrchestrator> {
  return await createOrchestrator(config, {
    enablePermissions: false, // Disable for testing
    // Fast retries
    retryOptions: {
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 1000
    },
  });
}
