/**
 * PermissionHandler Interface
 *
 * Abstracts tool execution permission evaluation and policy management.
 * The orchestrator checks permissions before executing each tool call.
 *
 * Node.js impl: wraps PermissionEvaluator (3 profiles, 4 policy types, audit logging)
 * Browser impl: modal-based approval flow (ModalPermissionHandler)
 *
 * @module interfaces/PermissionHandler
 */

/**
 * Permission decision — result of evaluating a tool execution request.
 */
export interface PermissionDecision {
  /** Whether execution is allowed */
  allowed: boolean;
  /**
   * Whether the user can override this decision (approval flow).
   * - true: blocked but user can approve via UI prompt
   * - false/undefined: decision is final
   */
  canApprove?: boolean;
  /** Human-readable reason for the decision */
  reason?: string;
  /** Policy tier that matched (for audit/debugging) */
  tier?: 'whitelist' | 'graylist' | 'blacklist';
}

/**
 * Permission policy — a rule that evaluates tool execution requests.
 */
export interface PermissionPolicy {
  /** Policy name (for identification and audit) */
  name: string;
  /** Policy type */
  type: 'whitelist' | 'blacklist' | 'file-operation' | 'bash-command';
  /**
   * Evaluate whether a tool execution is permitted.
   *
   * @param context - Tool execution context
   * @returns Permission decision
   */
  evaluate(context: {
    toolName: string;
    toolInput: any;
    sessionId: string;
  }): PermissionDecision;
}

/**
 * Permission Handler — tool execution permission abstraction.
 *
 * Evaluates whether tool calls should be permitted, denied, or
 * require user approval. Supports pluggable policies.
 */
export interface PermissionHandler {
  /**
   * Evaluate a tool execution request against all registered policies.
   *
   * @param context - Tool execution context
   * @returns Permission decision (allowed, denied, or needs approval)
   */
  evaluate(context: {
    toolName: string;
    toolInput: any;
    sessionId: string;
  }): Promise<PermissionDecision>;

  /**
   * Register a permission policy.
   *
   * @param policy - Policy to add to the evaluation chain
   */
  registerPolicy(policy: PermissionPolicy): void;
}
