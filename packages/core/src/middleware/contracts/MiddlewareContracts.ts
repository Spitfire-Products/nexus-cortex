/**
 * Middleware Interface Contracts
 *
 * These interfaces define the contracts that all middleware components must implement.
 * They are locked in on Day 1 of the parallel refactor and should NOT be changed
 * after Wave 1 begins.
 *
 * @version 1.0.0
 * @locked 2025-11-12
 */

import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import type { OrchestratorConfig } from '../../orchestrator/CortexOrchestrator.js';

// ============================================
// BASE MIDDLEWARE INTERFACES
// ============================================

/**
 * Context passed to all middleware operations
 */
export interface MiddlewareContext {
  sessionId: string;
  conversationId: string;
  turnNumber: number;
  modelId: string;
  config: OrchestratorConfig;
  approvalMode?: {
    autoApproveActions: boolean; // "auto approve actions - ON/OFF"
  };
}

/**
 * Base middleware interface
 */
export interface Middleware<TInput, TOutput> {
  name: string;
  enabled: boolean;

  process(
    input: TInput,
    context: MiddlewareContext,
    next: () => Promise<TOutput>
  ): Promise<TOutput>;
}

// ============================================
// ERROR CLASSIFICATION INTERFACES
// ============================================

/**
 * Classification result for an error
 */
export interface ErrorClassification {
  isRetryable: boolean;
  errorType: 'network' | 'permission' | 'validation' | 'abort' | 'rate_limit' | 'unknown';
  statusCode?: number;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Interface for error classification middleware
 */
export interface IErrorClassifier {
  /**
   * Classify an error and provide detailed information
   */
  classify(error: any): ErrorClassification;

  /**
   * Determine if an error is retryable
   */
  isRetryable(error: any): boolean;

  /**
   * Get the type of error
   */
  getErrorType(error: any): ErrorClassification['errorType'];
}

// ============================================
// RETRY INTERFACES
// ============================================

/**
 * Options for retry middleware
 */
export interface RetryOptions {
  maxRetries: number;           // Default: 3
  baseDelayMs: number;          // Default: 1000
  maxDelayMs: number;           // Default: 30000
  backoffMultiplier: number;    // Default: 2
  jitterFactor: number;         // Default: 0.1
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  result: T;
  attemptCount: number;
  totalDelayMs: number;
  errors: ErrorClassification[];
}

/**
 * Interface for retry middleware
 */
export interface IRetryExecutor {
  /**
   * Execute an operation with retry logic
   */
  executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<RetryResult<T>>;

  /**
   * Calculate delay for a given attempt number
   */
  calculateDelay(attempt: number): number;
}

// ============================================
// PERMISSIONS INTERFACES
// ============================================

/**
 * Permission decision result
 */
export type PermissionDecision =
  | { allowed: true; tier?: 'whitelist' } // Tier indicates explicit approval (whitelist) vs pass-through
  | {
      allowed: false;
      reason: string;
      canApprove: boolean;
      tier?: 'graylist' | 'blacklist'; // Approval tier for auto-approve logic
    };

/**
 * Context for permission evaluation
 */
export interface PermissionContext {
  toolName: string;
  toolInput: any;
  sessionId: string;
  userId?: string;
  timestamp: Date;
}

/**
 * Base permission policy interface
 */
export interface PermissionPolicy {
  name: string;
  priority: number;
  enabled: boolean;

  /**
   * Evaluate whether an operation should be allowed
   */
  evaluate(context: PermissionContext): Promise<PermissionDecision>;
}

/**
 * Approval request for dangerous operations
 */
export interface ApprovalRequest {
  toolName: string;
  toolInput: any;
  reason: string;
  timestamp: Date;
}

/**
 * Handler for approval requests
 */
export interface ApprovalHandler {
  /**
   * Request approval for a dangerous operation.
   *
   * @param request - The approval request to evaluate
   * @param signal - Optional AbortSignal. When aborted (e.g., by tool timeout), the handler
   *                 should reject the returned promise promptly. Interactive handlers MUST honor
   *                 this to avoid hanging tool-execution timeouts. Non-interactive handlers
   *                 (auto-approve, deny-all) can ignore it since they return immediately.
   */
  requestApproval(request: ApprovalRequest, signal?: AbortSignal): Promise<boolean>;
}

/**
 * Audit log entry for permission decisions
 */
export interface PermissionAuditEntry {
  timestamp: Date;
  sessionId: string;
  toolName: string;
  toolInput: any;
  decision: PermissionDecision;
  approvalRequested: boolean;
  approvalGranted?: boolean;
  userId?: string;
  policyName?: string;
}

/**
 * Interface for permissions middleware
 */
export interface IPermissionsChecker {
  /**
   * Check if a tool execution is permitted.
   *
   * @param signal - Optional AbortSignal. Forwarded to approval handlers so tool-execution
   *                 timeout can abort an interactive approval prompt instead of hanging.
   */
  checkPermission(
    toolName: string,
    toolInput: any,
    context: MiddlewareContext,
    signal?: AbortSignal
  ): Promise<PermissionDecision>;

  /**
   * Request approval for a denied operation.
   *
   * @param signal - Optional AbortSignal forwarded to the approval handler.
   */
  requestApproval(
    context: PermissionContext,
    reason: string,
    signal?: AbortSignal
  ): Promise<boolean>;

  /**
   * Get audit log entries for a session
   */
  getAuditLog(sessionId: string): PermissionAuditEntry[];
}

// ============================================
// SYSTEM MESSAGE INTERFACES
// ============================================

/**
 * Context for system message injection
 */
export interface InjectionContext {
  turnNumber: number;
  sessionPhase: 'start' | 'ongoing' | 'end';
  hasTools: boolean;
  toolCount: number;
  modelCapabilities: Array<'reasoning' | 'vision' | 'tools' | 'streaming'>;
  apiPattern: string;
  sessionId: string;
}

/**
 * Template variables for system messages
 */
export interface TemplateVariables {
  projectPath?: string;
  workspacePath?: string;
  currentDate: string;
  currentTime: string;
  toolCount: number;
  toolNames: string[];
  sandboxEnabled: boolean;
  modelId?: string;
  platform?: string;
}

/**
 * Interface for system message injection middleware
 */
export interface ISystemMessageInjector {
  /**
   * Inject system messages into user content
   */
  injectSystemMessages(
    userContent: string | any[],
    model: ModelConfig,
    hasTools: boolean,
    context: MiddlewareContext
  ): Promise<any[]>;

  /**
   * Build injection context from session state
   */
  buildInjectionContext(
    model: ModelConfig,
    hasTools: boolean,
    context: MiddlewareContext
  ): InjectionContext;

  /**
   * Build template variables for system messages
   */
  buildTemplateVariables(
    toolCount: number,
    context: MiddlewareContext
  ): TemplateVariables;
}

// ============================================
// MENTORSHIP INTERFACES
// ============================================

/**
 * Error pattern tracked by mentorship system
 */
export interface ErrorPattern {
  pattern: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

/**
 * Tool result for mentorship evaluation
 */
export interface MentorshipToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Interface for mentorship middleware
 */
export interface IMentorshipProvider {
  /**
   * Check if a tool result should trigger mentorship
   */
  shouldTriggerMentorship(
    toolResult: MentorshipToolResult,
    context: MiddlewareContext
  ): boolean;

  /**
   * Track an error pattern
   */
  trackErrorPattern(error: any, toolName: string): void;

  /**
   * Handle detected error pattern
   */
  handlePatternDetection(
    pattern: string,
    context: MiddlewareContext
  ): Promise<void>;

  /**
   * Inject thinking block into response
   */
  injectThinkingBlock(response: any, guidance: string): any;

  /**
   * Get error patterns for a session
   */
  getErrorPatterns(sessionId: string): ErrorPattern[];

  /**
   * Clear patterns for a session
   */
  clearPatterns(sessionId: string): void;
}

// ============================================
// CONFIGURATION INTERFACES
// ============================================

/**
 * Configuration for all middleware components
 */
export interface MiddlewareConfig {
  errorClassifier?: IErrorClassifier;
  retryExecutor?: IRetryExecutor;
  permissionsChecker?: IPermissionsChecker;
  systemMessageInjector?: ISystemMessageInjector;
  mentorshipProvider?: IMentorshipProvider;
}

/**
 * Middleware registry for dependency injection
 */
export interface IMiddlewareRegistry {
  register<T>(name: string, implementation: T): void;
  get<T>(name: string): T | undefined;
  has(name: string): boolean;
}
