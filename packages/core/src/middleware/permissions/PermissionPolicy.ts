/**
 * Permission Policy Base Types
 *
 * Re-exports the base permission policy types from the middleware contracts.
 * This file serves as a central point for policy-related types and constants.
 *
 * @module permissions/PermissionPolicy
 */

export type {
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
  PermissionAuditEntry,
} from '../contracts/MiddlewareContracts.js';

/**
 * Policy priority levels
 * Higher numbers = higher priority (evaluated first)
 */
export const PolicyPriority = {
  /** Critical security blocks (e.g., blacklist) */
  CRITICAL: 100,

  /** High priority validation (e.g., file path, command validation) */
  HIGH: 80,

  /** Medium priority (e.g., custom policies) */
  MEDIUM: 60,

  /** Low priority (e.g., whitelist) */
  LOW: 40,

  /** Default allow fallback */
  DEFAULT: 20,
} as const;

/**
 * Policy evaluation modes
 */
export enum PolicyEvaluationMode {
  /** First deny wins, all must allow */
  FIRST_DENY = 'first_deny',

  /** First allow wins (permissive) */
  FIRST_ALLOW = 'first_allow',

  /** All policies must allow (strict) */
  ALL_ALLOW = 'all_allow',
}

/**
 * Base abstract class for permission policies
 * Provides common functionality for all policy implementations
 */
export abstract class BasePermissionPolicy {
  constructor(
    public readonly name: string,
    public readonly priority: number,
    public enabled: boolean = true
  ) {}

  /**
   * Abstract evaluate method - must be implemented by subclasses
   */
  abstract evaluate(
    context: import('../contracts/MiddlewareContracts.js').PermissionContext
  ): Promise<import('../contracts/MiddlewareContracts.js').PermissionDecision>;

  /**
   * Helper method to create an allowed decision
   */
  protected allow(): import('../contracts/MiddlewareContracts.js').PermissionDecision {
    return { allowed: true };
  }

  /**
   * Helper method to create a denied decision
   */
  protected deny(
    reason: string,
    canApprove: boolean = false
  ): import('../contracts/MiddlewareContracts.js').PermissionDecision {
    return {
      allowed: false,
      reason,
      canApprove,
    };
  }
}
