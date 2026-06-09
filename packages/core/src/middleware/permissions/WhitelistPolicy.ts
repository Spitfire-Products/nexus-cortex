/**
 * Whitelist Permission Policy
 *
 * Only allows specific tools to be executed. Any tool not in the whitelist
 * is denied without the option for approval.
 *
 * Priority: LOW (40) - Evaluated after more specific policies
 *
 * @module permissions/WhitelistPolicy
 */

import type {
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
} from '../contracts/MiddlewareContracts.js';
import { BasePermissionPolicy, PolicyPriority } from './PermissionPolicy.js';

/**
 * Whitelist permission policy
 *
 * @example
 * ```typescript
 * const policy = new WhitelistPolicy(['read_file', 'write_file', 'execute_bash']);
 *
 * await policy.evaluate({
 *   toolName: 'read_file',
 *   toolInput: {},
 *   sessionId: '123',
 *   timestamp: new Date()
 * }); // Returns { allowed: true }
 *
 * await policy.evaluate({
 *   toolName: 'delete_file',
 *   toolInput: {},
 *   sessionId: '123',
 *   timestamp: new Date()
 * }); // Returns { allowed: false, reason: '...', canApprove: false }
 * ```
 */
export class WhitelistPolicy extends BasePermissionPolicy implements PermissionPolicy {
  private allowedTools: Set<string>;

  /**
   * Create a new whitelist policy
   *
   * @param allowedTools Array of tool names that are allowed
   * @param priority Policy priority (default: PolicyPriority.LOW)
   * @param enabled Whether the policy is enabled (default: true)
   */
  constructor(
    allowedTools: string[],
    priority: number = PolicyPriority.LOW,
    enabled: boolean = true
  ) {
    super('whitelist', priority, enabled);
    this.allowedTools = new Set(allowedTools);
  }

  /**
   * Evaluate if a tool is in the whitelist
   */
  async evaluate(context: PermissionContext): Promise<PermissionDecision> {
    if (this.allowedTools.has(context.toolName)) {
      return this.allow();
    }

    return this.deny(
      `Tool "${context.toolName}" is not in the whitelist`,
      false // Cannot approve - hard block
    );
  }

  /**
   * Add a tool to the whitelist
   */
  addTool(toolName: string): void {
    this.allowedTools.add(toolName);
  }

  /**
   * Remove a tool from the whitelist
   */
  removeTool(toolName: string): boolean {
    return this.allowedTools.delete(toolName);
  }

  /**
   * Check if a tool is in the whitelist
   */
  hasTool(toolName: string): boolean {
    return this.allowedTools.has(toolName);
  }

  /**
   * Get all whitelisted tools
   */
  getAllowedTools(): string[] {
    return Array.from(this.allowedTools);
  }
}
