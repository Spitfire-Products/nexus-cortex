/**
 * IPC Approval Handler
 *
 * Used by sub-agent child processes to forward permission requests
 * to the parent process via IPC. The parent process displays the
 * approval UI to the user and sends the response back.
 *
 * This ensures sub-agents have the same permission harness as the
 * main model (whitelist/graylist/blacklist with user approval).
 *
 * @module permissions/IPCApprovalHandler
 */

import { v4 as uuidv4 } from 'uuid';
import type { ApprovalHandler, ApprovalRequest } from '../contracts/MiddlewareContracts.js';
import type { IPCPermissionResponseMessage } from '../../orchestrator/SubAgentIPC.js';

/**
 * Options for IPC approval handler
 */
export interface IPCApprovalHandlerOptions {
  /**
   * Agent ID for correlation
   */
  agentId: string;

  /**
   * Timeout for waiting for parent response (ms)
   * @default 300000 (5 minutes)
   */
  timeoutMs?: number;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

/**
 * Pending approval request awaiting parent response
 */
interface PendingApproval {
  requestId: string;
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

/**
 * IPC-based approval handler for sub-agent processes
 *
 * Sends permission requests to the parent process and waits for
 * the response. The parent process is responsible for displaying
 * the approval UI to the user.
 *
 * @example
 * ```typescript
 * // In sub-agent child process
 * const handler = new IPCApprovalHandler({
 *   agentId: 'agent-123',
 *   timeoutMs: 60000
 * });
 *
 * // Register to receive responses from parent
 * process.on('message', (msg) => {
 *   if (msg.type === 'permission_response') {
 *     handler.handleResponse(msg);
 *   }
 * });
 *
 * // Request approval (will send IPC to parent and wait)
 * const approved = await handler.requestApproval({
 *   toolName: 'Write',
 *   toolInput: { file_path: '/workspace/file.txt', content: '...' },
 *   reason: 'File write requires approval',
 *   timestamp: new Date()
 * });
 * ```
 */
export class IPCApprovalHandler implements ApprovalHandler {
  private options: Required<IPCApprovalHandlerOptions>;
  private pendingApprovals: Map<string, PendingApproval> = new Map();

  constructor(options: IPCApprovalHandlerOptions) {
    this.options = {
      agentId: options.agentId,
      timeoutMs: options.timeoutMs ?? 300000,
      debug: options.debug ?? false,
    };
  }

  /**
   * Request approval by sending IPC message to parent and waiting for response.
   *
   * Signal honors tool-execution abort: if the orchestrator aborts (e.g. tool timeout),
   * the pending approval is resolved as denied instead of hanging until its own timeout.
   */
  async requestApproval(request: ApprovalRequest, signal?: AbortSignal): Promise<boolean> {
    const requestId = uuidv4();

    if (this.options.debug) {
      console.log(`[IPCApprovalHandler] Requesting approval: ${request.toolName} (${requestId})`);
    }

    // Short-circuit if already aborted
    if (signal?.aborted) {
      if (this.options.debug) {
        console.log(`[IPCApprovalHandler] Request aborted before send: ${requestId}`);
      }
      return false;
    }

    // Create promise that will be resolved when parent responds
    return new Promise<boolean>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (this.options.debug) {
          console.log(`[IPCApprovalHandler] Approval request timed out: ${requestId}`);
        }
        // On timeout, deny the request for safety
        resolve(false);
      }, this.options.timeoutMs);

      // Wire AbortSignal — deny immediately if orchestrator aborts
      const onAbort = () => {
        clearTimeout(timeoutId);
        this.pendingApprovals.delete(requestId);
        if (this.options.debug) {
          console.log(`[IPCApprovalHandler] Approval request aborted: ${requestId}`);
        }
        resolve(false);
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      // Store pending approval
      this.pendingApprovals.set(requestId, {
        requestId,
        resolve,
        reject,
        timeoutId,
      });

      // Send IPC message to parent
      if (process.send) {
        process.send({
          type: 'permission_request',
          payload: {
            agentId: this.options.agentId,
            requestId,
            toolName: request.toolName,
            toolInput: request.toolInput,
            reason: request.reason,
            timestamp: request.timestamp.toISOString(),
          },
        });
      } else {
        // Not running as child process - deny for safety
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
        this.pendingApprovals.delete(requestId);
        if (this.options.debug) {
          console.log(`[IPCApprovalHandler] Not running as child process, denying request`);
        }
        resolve(false);
      }
    });
  }

  /**
   * Handle response from parent process
   * Call this when receiving a 'permission_response' IPC message
   */
  handleResponse(message: IPCPermissionResponseMessage): void {
    const { requestId, approved, reason } = message.payload;

    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      if (this.options.debug) {
        console.log(`[IPCApprovalHandler] Received response for unknown request: ${requestId}`);
      }
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeoutId);
    this.pendingApprovals.delete(requestId);

    if (this.options.debug) {
      console.log(
        `[IPCApprovalHandler] Received approval response: ${requestId} -> ${approved}` +
        (reason ? ` (${reason})` : '')
      );
    }

    // Resolve the pending promise
    pending.resolve(approved);
  }

  /**
   * Check if there are any pending approval requests
   */
  hasPendingRequests(): boolean {
    return this.pendingApprovals.size > 0;
  }

  /**
   * Get count of pending approval requests
   */
  getPendingCount(): number {
    return this.pendingApprovals.size;
  }

  /**
   * Cancel all pending requests (e.g., on shutdown)
   */
  cancelAll(): void {
    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timeoutId);
      pending.resolve(false);
    }
    this.pendingApprovals.clear();
  }
}
