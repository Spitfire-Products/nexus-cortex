/**
 * Approval Handler Interface
 *
 * Re-exports the approval handler types from middleware contracts.
 * Provides a central import point for approval-related types.
 *
 * @module permissions/ApprovalHandler
 */

export type { ApprovalHandler, ApprovalRequest } from '../contracts/MiddlewareContracts.js';

/**
 * Approval timeout error
 */
export class ApprovalTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Approval request timed out after ${timeoutMs}ms`);
    this.name = 'ApprovalTimeoutError';
  }
}

/**
 * Approval rejected error
 */
export class ApprovalRejectedError extends Error {
  constructor(reason?: string) {
    super(reason || 'Approval request was rejected');
    this.name = 'ApprovalRejectedError';
  }
}
