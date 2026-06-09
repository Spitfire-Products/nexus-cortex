/**
 * React/Ink-compatible Approval Handler
 *
 * This hook creates an ApprovalHandler that integrates with Ink's React-based UI
 * instead of using raw stdin like CLIApprovalHandler.
 *
 * The handler uses a callback pattern:
 * 1. When approval is needed, it sets pending approval state
 * 2. The UI renders a confirmation dialog
 * 3. When user responds, the handler resolves/rejects the pending promise
 */

import { useState, useCallback, useRef } from 'react';

/**
 * Request for tool approval (matches core's ApprovalRequest)
 */
export interface ApprovalRequest {
  toolName: string;
  toolInput: any;
  reason: string;
  timestamp: Date;
}

/**
 * Handler interface for tool approval (matches core's ApprovalHandler)
 */
export interface ApprovalHandler {
  requestApproval(request: ApprovalRequest): Promise<boolean>;
}

/**
 * Pending approval request with resolve/reject callbacks
 */
export interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
}

/**
 * Return type for the useReactApprovalHandler hook
 */
export interface UseReactApprovalHandlerReturn {
  /** The ApprovalHandler to pass to the orchestrator */
  handler: ApprovalHandler;
  /** Current pending approval request (null if none) */
  pendingApproval: PendingApproval | null;
  /** Call to approve the pending request */
  approve: () => void;
  /** Call to deny the pending request */
  deny: () => void;
  /** Call to approve and enable auto-approve for the session */
  approveAndEnableYolo: () => void;
}

/**
 * Hook that creates a React-compatible ApprovalHandler
 *
 * @param onYoloToggle - Callback when user wants to enable YOLO mode
 * @returns Handler and UI state for rendering approval dialogs
 *
 * @example
 * ```tsx
 * const { handler, pendingApproval, approve, deny } = useReactApprovalHandler();
 *
 * // Pass handler to orchestrator
 * orchestrator.setApprovalHandler(handler);
 *
 * // Render approval dialog when pendingApproval is not null
 * {pendingApproval && (
 *   <ApprovalDialog
 *     request={pendingApproval.request}
 *     onApprove={approve}
 *     onDeny={deny}
 *   />
 * )}
 * ```
 */
export function useReactApprovalHandler(
  onYoloToggle?: () => void
): UseReactApprovalHandlerReturn {
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const pendingRef = useRef<PendingApproval | null>(null);

  // Keep ref in sync for handler closure
  const updatePending = useCallback((pending: PendingApproval | null) => {
    pendingRef.current = pending;
    setPendingApproval(pending);
  }, []);

  // Approve the pending request
  const approve = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.resolve(true);
      updatePending(null);
    }
  }, [updatePending]);

  // Deny the pending request
  const deny = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
      updatePending(null);
    }
  }, [updatePending]);

  // Approve and enable YOLO mode
  const approveAndEnableYolo = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.resolve(true);
      updatePending(null);
      onYoloToggle?.();
    }
  }, [updatePending, onYoloToggle]);

  // Create the handler object (stable reference)
  const handler = useRef<ApprovalHandler>({
    requestApproval: async (request: ApprovalRequest): Promise<boolean> => {
      return new Promise((resolve) => {
        updatePending({ request, resolve });
      });
    }
  }).current;

  return {
    handler,
    pendingApproval,
    approve,
    deny,
    approveAndEnableYolo,
  };
}

export default useReactApprovalHandler;
