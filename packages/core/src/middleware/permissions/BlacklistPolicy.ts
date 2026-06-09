/**
 * Blacklist Permission Policy
 *
 * Blocks specific tools from being executed. Any tool in the blacklist
 * is denied without the option for approval.
 *
 * Priority: CRITICAL (100) - Evaluated first for security
 *
 * @module permissions/BlacklistPolicy
 */

import type {
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
} from '../contracts/MiddlewareContracts.js';
import { BasePermissionPolicy, PolicyPriority } from './PermissionPolicy.js';

/**
 * Blacklist permission policy
 *
 * @example
 * ```typescript
 * const policy = new BlacklistPolicy(['delete_file', 'format_disk']);
 *
 * await policy.evaluate({
 *   toolName: 'delete_file',
 *   toolInput: {},
 *   sessionId: '123',
 *   timestamp: new Date()
 * }); // Returns { allowed: false, reason: '...', canApprove: false }
 *
 * await policy.evaluate({
 *   toolName: 'read_file',
 *   toolInput: {},
 *   sessionId: '123',
 *   timestamp: new Date()
 * }); // Returns { allowed: true }
 * ```
 */
export class BlacklistPolicy extends BasePermissionPolicy implements PermissionPolicy {
  private blockedTools: Set<string>;

  /**
   * Create a new blacklist policy
   *
   * @param blockedTools Array of tool names that are blocked
   * @param priority Policy priority (default: PolicyPriority.CRITICAL)
   * @param enabled Whether the policy is enabled (default: true)
   */
  constructor(
    blockedTools: string[],
    priority: number = PolicyPriority.CRITICAL,
    enabled: boolean = true
  ) {
    super('blacklist', priority, enabled);
    this.blockedTools = new Set(blockedTools);
  }

  /**
   * Evaluate if a tool is in the blacklist
   */
  async evaluate(context: PermissionContext): Promise<PermissionDecision> {
    if (this.blockedTools.has(context.toolName)) {
      return this.deny(
        `Tool "${context.toolName}" is blacklisted and cannot be executed`,
        false // Cannot approve - hard block
      );
    }

    return this.allow();
  }

  /**
   * Add a tool to the blacklist
   */
  addTool(toolName: string): void {
    this.blockedTools.add(toolName);
  }

  /**
   * Remove a tool from the blacklist
   */
  removeTool(toolName: string): boolean {
    return this.blockedTools.delete(toolName);
  }

  /**
   * Check if a tool is in the blacklist
   */
  hasTool(toolName: string): boolean {
    return this.blockedTools.has(toolName);
  }

  /**
   * Get all blacklisted tools
   */
  getBlockedTools(): string[] {
    return Array.from(this.blockedTools);
  }
}
