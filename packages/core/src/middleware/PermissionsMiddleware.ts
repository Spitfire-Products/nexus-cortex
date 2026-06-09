/**
 * Permissions Middleware
 *
 * Central authorization layer for tool execution. Evaluates permission
 * policies before allowing tools to execute, handles approval requests,
 * and maintains audit logs.
 *
 * Features:
 * - Policy-based authorization
 * - Priority-ordered policy evaluation
 * - Approval flow for dangerous operations
 * - Comprehensive audit logging
 * - Session-based permission tracking
 *
 * @module middleware/PermissionsMiddleware
 */

import type {
  IPermissionsChecker,
  PermissionDecision,
  PermissionContext,
  PermissionAuditEntry,
  PermissionPolicy,
  ApprovalHandler,
  MiddlewareContext,
} from './contracts/MiddlewareContracts.js';

import { PermissionEvaluator } from './permissions/PermissionEvaluator.js';
import { PermissionAuditLogger } from './permissions/PermissionAuditLogger.js';

/**
 * Options for permissions middleware
 */
export interface PermissionsMiddlewareOptions {
  /**
   * Initial policies to register
   */
  policies?: PermissionPolicy[];

  /**
   * Approval handler for denied operations
   */
  approvalHandler?: ApprovalHandler;

  /**
   * Audit logger for permission decisions
   */
  auditLogger?: PermissionAuditLogger;

  /**
   * Default policy when no policies match
   * @default 'deny'
   */
  defaultPolicy?: 'allow' | 'deny';

  /**
   * Whether to enable debug logging
   * @default false
   */
  enableLogging?: boolean;

  /**
   * When true, every permission check returns `{ allowed: true }` without
   * consulting policies or approval handlers. Used by YOLO mode to make a
   * clean bypass that hard-deny policies (e.g. WhitelistPolicy with
   * `canApprove: false`) cannot otherwise short-circuit.
   *
   * @default false
   */
  bypassAll?: boolean;
}

/**
 * Permissions middleware implementation
 *
 * @example
 * ```typescript
 * const middleware = new PermissionsMiddleware({
 *   policies: [
 *     new WhitelistPolicy(['read_file', 'write_file']),
 *     new FileOperationPolicy({
 *       allowedPaths: ['/workspace'],
 *       blockedPaths: ['/etc', '/root']
 *     }),
 *     new BashCommandPolicy({
 *       allowedCommands: [],
 *       blockedCommands: ['rm -rf /']
 *     })
 *   ],
 *   approvalHandler: new CLIApprovalHandler(),
 *   auditLogger: new PermissionAuditLogger('/path/to/audit.log')
 * });
 *
 * const decision = await middleware.checkPermission(
 *   'read_file',
 *   { file_path: '/workspace/file.txt' },
 *   context
 * );
 * ```
 */
export class PermissionsMiddleware implements IPermissionsChecker {
  private evaluator: PermissionEvaluator;
  private approvalHandler?: ApprovalHandler;
  private auditLogger?: PermissionAuditLogger;
  private enableLogging: boolean;
  private bypassAll: boolean;

  // Cache for session audit entries (in-memory)
  private sessionAuditCache: Map<string, PermissionAuditEntry[]> = new Map();

  /**
   * Create a new permissions middleware
   *
   * @param options Middleware options
   */
  constructor(options: PermissionsMiddlewareOptions = {}) {
    this.evaluator = new PermissionEvaluator({
      defaultPolicy: options.defaultPolicy ?? 'deny',
      enableLogging: options.enableLogging ?? false,
    });

    this.approvalHandler = options.approvalHandler;
    this.auditLogger = options.auditLogger;
    this.enableLogging = options.enableLogging ?? false;
    this.bypassAll = options.bypassAll ?? false;

    // Register initial policies
    if (options.policies) {
      for (const policy of options.policies) {
        this.registerPolicy(policy);
      }
    }
  }

  /**
   * Check permission for a tool execution
   *
   * @param toolName The name of the tool to execute
   * @param toolInput The input parameters for the tool
   * @param context The middleware context
   * @returns Permission decision with reason if denied
   */
  async checkPermission(
    toolName: string,
    toolInput: any,
    context: MiddlewareContext,
    signal?: AbortSignal
  ): Promise<PermissionDecision> {
    const permissionContext: PermissionContext = {
      toolName,
      toolInput,
      sessionId: context.sessionId,
      userId: undefined, // Could be added from context in the future
      timestamp: new Date(),
    };

    // YOLO bypass — short-circuit before policy evaluation. This is the only
    // way to override a hard-deny policy (e.g. WhitelistPolicy with
    // canApprove: false), since approval handlers cannot rescue those.
    if (this.bypassAll) {
      if (this.enableLogging) {
        console.log(
          `[PermissionsMiddleware] bypassAll active — allowing ${toolName} without evaluation`,
        );
      }
      await this.logDecision(permissionContext, { allowed: true }, true, true);
      return { allowed: true };
    }

    if (this.enableLogging) {
      console.log(
        `[PermissionsMiddleware] Checking permission for ${toolName} in session ${context.sessionId}`
      );
    }

    // Evaluate policies
    const result = await this.evaluator.evaluate(permissionContext);

    // Log the decision
    await this.logDecision(permissionContext, result.decision, false);

    // Whitelist: allowed=true → execute immediately
    if (result.decision.allowed) {
      return { allowed: true };
    }

    // Graylist + auto-approve ON → auto-approve
    if (
      result.decision.tier === 'graylist' &&
      context.approvalMode?.autoApproveActions === true
    ) {
      if (this.enableLogging) {
        console.log(
          `[PermissionsMiddleware] Graylist tool ${toolName} auto-approved (auto approve actions - ON)`
        );
      }
      await this.logDecision(permissionContext, { allowed: true }, true, true);
      return { allowed: true };
    }

    // Graylist (auto-approve OFF) or Blacklist → request approval
    if (result.decision.canApprove) {
      if (this.approvalHandler) {
        try {
          const approved = await this.requestApproval(
            permissionContext,
            result.decision.reason,
            signal
          );

          if (approved) {
            // Log the approval
            await this.logDecision(permissionContext, { allowed: true }, true, true);

            return { allowed: true };
          } else {
            // Log the denial
            await this.logDecision(
              permissionContext,
              result.decision,
              true,
              false
            );
          }
        } catch (error) {
          console.error(
            '[PermissionsMiddleware] Error during approval request:',
            error
          );

          // Log the error
          await this.logDecision(
            permissionContext,
            {
              allowed: false,
              reason: `Approval error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              canApprove: false,
            },
            true,
            false
          );
        }
      } else {
        // No approval handler - deny
        if (this.enableLogging) {
          console.log(
            '[PermissionsMiddleware] No approval handler configured - denying'
          );
        }
      }
    }

    return result.decision;
  }

  /**
   * Request approval for a denied operation
   *
   * @param context The permission context
   * @param reason The reason for denial
   * @returns True if approved, false otherwise
   */
  async requestApproval(
    context: PermissionContext,
    reason: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this.approvalHandler) {
      return false;
    }

    try {
      return await this.approvalHandler.requestApproval({
        toolName: context.toolName,
        toolInput: context.toolInput,
        reason,
        timestamp: context.timestamp,
      }, signal);
    } catch (error) {
      console.error('[PermissionsMiddleware] Approval request error:', error);
      return false;
    }
  }

  /**
   * Register a permission policy
   *
   * @param policy The policy to register
   */
  registerPolicy(policy: PermissionPolicy): void {
    this.evaluator.registerPolicy(policy);
  }

  /**
   * Unregister a permission policy
   *
   * @param policyName The name of the policy to unregister
   * @returns True if the policy was found and removed
   */
  unregisterPolicy(policyName: string): boolean {
    return this.evaluator.unregisterPolicy(policyName);
  }

  /**
   * Get all registered policies
   */
  getPolicies(): ReadonlyArray<PermissionPolicy> {
    return this.evaluator.getPolicies();
  }

  /**
   * Get audit log entries for a session
   *
   * @param sessionId The session ID to query
   * @returns Array of audit entries for the session
   */
  getAuditLog(sessionId: string): PermissionAuditEntry[] {
    // Return from in-memory cache
    return this.sessionAuditCache.get(sessionId) || [];
  }

  /**
   * Get audit log entries from persistent storage
   *
   * @param sessionId The session ID to query
   * @returns Array of audit entries from storage
   */
  async getAuditLogFromStorage(
    sessionId: string
  ): Promise<PermissionAuditEntry[]> {
    if (!this.auditLogger) {
      return [];
    }

    return this.auditLogger.getEntriesBySession(sessionId);
  }

  /**
   * Get all denied operations across all sessions
   */
  async getAllDeniedOperations(): Promise<PermissionAuditEntry[]> {
    if (!this.auditLogger) {
      return [];
    }

    return this.auditLogger.getDeniedOperations();
  }

  /**
   * Get audit statistics
   */
  async getStatistics() {
    if (!this.auditLogger) {
      return null;
    }

    return this.auditLogger.getStatistics();
  }

  /**
   * Clear audit cache for a session
   *
   * @param sessionId The session ID to clear
   */
  clearSessionCache(sessionId: string): void {
    this.sessionAuditCache.delete(sessionId);
  }

  /**
   * Log a permission decision
   */
  private async logDecision(
    context: PermissionContext,
    decision: PermissionDecision,
    approvalRequested: boolean,
    approvalGranted?: boolean
  ): Promise<void> {
    const entry: PermissionAuditEntry = {
      timestamp: context.timestamp,
      sessionId: context.sessionId,
      toolName: context.toolName,
      toolInput: context.toolInput,
      decision,
      approvalRequested,
      approvalGranted,
      userId: context.userId,
      policyName: undefined, // Could be added from evaluator result
    };

    // Add to in-memory cache
    if (!this.sessionAuditCache.has(context.sessionId)) {
      this.sessionAuditCache.set(context.sessionId, []);
    }
    this.sessionAuditCache.get(context.sessionId)!.push(entry);

    // Log to persistent storage
    if (this.auditLogger) {
      try {
        await this.auditLogger.log(entry);
      } catch (error) {
        console.error('[PermissionsMiddleware] Failed to log audit entry:', error);
      }
    }
  }

  /**
   * Close the middleware and cleanup resources
   */
  async close(): Promise<void> {
    if (this.auditLogger) {
      await this.auditLogger.close();
    }

    this.sessionAuditCache.clear();
  }

  /**
   * Set the approval handler (for switching to YOLO mode)
   *
   * @param handler - The new approval handler
   */
  setApprovalHandler(handler: ApprovalHandler | undefined): void {
    this.approvalHandler = handler;
  }

  /**
   * Get the current approval handler
   */
  getApprovalHandler(): ApprovalHandler | undefined {
    return this.approvalHandler;
  }

  /**
   * Create a default permissions middleware with common policies
   *
   * @param workspacePath The workspace path to allow
   * @param auditLogPath Optional path to audit log file
   * @returns Configured permissions middleware
   */
  static async createDefault(
    workspacePath: string,
    auditLogPath?: string
  ): Promise<PermissionsMiddleware> {
    const { FileOperationPolicy } = await import('./permissions/FileOperationPolicy.js');
    const { BashCommandPolicy } = await import('./permissions/BashCommandPolicy.js');
    const { WhitelistPolicy } = await import('./permissions/WhitelistPolicy.js');

    return new PermissionsMiddleware({
      policies: [
        new FileOperationPolicy({
          allowedPaths: [workspacePath],
          blockedPaths: ['/etc', '/root', '/.git', '/node_modules'],
          requireApprovalForDelete: true,
        }),
        new BashCommandPolicy({
          allowedCommands: [],
          blockedCommands: ['rm -rf /', 'sudo rm'],
          requireApprovalForDangerous: true,
        }),
        new WhitelistPolicy([
          'Read',
          'Write',
          'Edit',
          'Bash',
          'Glob',
          'Grep',
          'CreateArtifactTool',
        ]),
      ],
      auditLogger: auditLogPath
        ? new PermissionAuditLogger(auditLogPath)
        : undefined,
      defaultPolicy: 'deny',
    });
  }
}
