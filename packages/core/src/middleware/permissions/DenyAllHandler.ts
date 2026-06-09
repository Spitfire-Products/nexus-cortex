/**
 * Deny-All Handler
 *
 * Automatically denies all permission requests.
 * Useful for strict security environments and testing.
 *
 * @module permissions/DenyAllHandler
 */

import type { ApprovalHandler, ApprovalRequest } from '../contracts/MiddlewareContracts.js';

/**
 * Options for deny-all handler
 */
export interface DenyAllHandlerOptions {
  /**
   * Whether to log denial requests
   * @default true
   */
  enableLogging?: boolean;

  /**
   * Custom denial message
   */
  customMessage?: string;
}

/**
 * Deny-all handler that automatically rejects all operations
 *
 * @example
 * ```typescript
 * const handler = new DenyAllHandler({ enableLogging: true });
 *
 * const approved = await handler.requestApproval({
 *   toolName: 'delete_file',
 *   toolInput: { file_path: '/workspace/file.txt' },
 *   reason: 'Delete operation requires approval',
 *   timestamp: new Date()
 * });
 * // Returns: false (always)
 * ```
 */
export class DenyAllHandler implements ApprovalHandler {
  private options: Required<DenyAllHandlerOptions>;
  private denialCount = 0;

  constructor(options: DenyAllHandlerOptions = {}) {
    this.options = {
      enableLogging: options.enableLogging ?? true,
      customMessage:
        options.customMessage ?? 'All approval requests are denied by policy',
    };
  }

  /**
   * Deny the request (always returns false).
   * Signal parameter accepted for API consistency but ignored — denial is immediate.
   */
  async requestApproval(request: ApprovalRequest, _signal?: AbortSignal): Promise<boolean> {
    this.denialCount++;

    if (this.options.enableLogging) {
      console.log(
        `[DenyAll] Denying operation #${this.denialCount}: ${request.toolName}`
      );
      console.log(`[DenyAll] Reason: ${this.options.customMessage}`);
    }

    return false;
  }

  /**
   * Get the number of denials
   */
  getDenialCount(): number {
    return this.denialCount;
  }

  /**
   * Reset the denial counter
   */
  resetCounter(): void {
    this.denialCount = 0;
  }
}
