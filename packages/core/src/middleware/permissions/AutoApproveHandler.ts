/**
 * Auto-Approve Handler
 *
 * Automatically approves all permission requests.
 * Useful for testing, automation, and trusted environments.
 *
 * WARNING: This handler bypasses all security checks.
 * Use only in controlled environments.
 *
 * @module permissions/AutoApproveHandler
 */

import type { ApprovalHandler, ApprovalRequest } from '../contracts/MiddlewareContracts.js';

/**
 * Options for auto-approve handler
 */
export interface AutoApproveHandlerOptions {
  /**
   * Whether to log approval requests
   * @default true
   */
  enableLogging?: boolean;

  /**
   * Maximum number of auto-approvals per session
   * @default Infinity
   */
  maxApprovals?: number;
}

/**
 * Auto-approve handler that automatically allows all operations
 *
 * @example
 * ```typescript
 * const handler = new AutoApproveHandler({ enableLogging: true });
 *
 * const approved = await handler.requestApproval({
 *   toolName: 'delete_file',
 *   toolInput: { file_path: '/workspace/file.txt' },
 *   reason: 'Delete operation requires approval',
 *   timestamp: new Date()
 * });
 * // Returns: true (always)
 * ```
 */
export class AutoApproveHandler implements ApprovalHandler {
  private options: Required<AutoApproveHandlerOptions>;
  private approvalCount = 0;

  constructor(options: AutoApproveHandlerOptions = {}) {
    this.options = {
      enableLogging: options.enableLogging ?? true,
      maxApprovals: options.maxApprovals ?? Infinity,
    };
  }

  /**
   * Auto-approve the request (always returns true).
   * Signal parameter accepted for API consistency but ignored — auto-approval is immediate.
   */
  async requestApproval(request: ApprovalRequest, _signal?: AbortSignal): Promise<boolean> {
    this.approvalCount++;

    if (this.options.enableLogging) {
      console.log(
        `[AutoApprove] Automatically approving operation #${this.approvalCount}: ${request.toolName}`
      );
    }

    // Check if max approvals reached
    if (this.approvalCount > this.options.maxApprovals) {
      if (this.options.enableLogging) {
        console.log(
          `[AutoApprove] Max approvals (${this.options.maxApprovals}) reached. Denying request.`
        );
      }
      return false;
    }

    return true;
  }

  /**
   * Get the number of approvals granted
   */
  getApprovalCount(): number {
    return this.approvalCount;
  }

  /**
   * Reset the approval counter
   */
  resetCounter(): void {
    this.approvalCount = 0;
  }
}
