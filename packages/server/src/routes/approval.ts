/**
 * Approval Mode API Endpoints
 *
 * Manages "auto approve actions" mode for the session.
 * Allows interactive clients to toggle approval behavior for graylist tools.
 */
import { Router, Request, Response } from 'express';
import { getServerOrchestrator } from './messages.js';

export const approvalRouter = Router();

/**
 * GET /v1/approval-mode
 *
 * Get current approval mode settings
 *
 * Response:
 * {
 *   autoApproveActions: boolean,
 *   yoloMode: boolean
 * }
 */
approvalRouter.get('/v1/approval-mode', (req: Request, res: Response) => {
  const serverOrchestrator = getServerOrchestrator();

  if (!serverOrchestrator) {
    return res.status(503).json({
      error: {
        message: 'Orchestrator not initialized',
        type: 'service_unavailable'
      }
    });
  }

  const mode = serverOrchestrator.getApprovalMode();
  const yoloMode = process.env.YOLO === 'true';

  res.json({
    autoApproveActions: mode.autoApproveActions,
    yoloMode,
    context: yoloMode
      ? 'YOLO mode active - all permissions bypassed'
      : mode.autoApproveActions
      ? 'Auto-approve ON - graylist tools execute without prompt'
      : 'Auto-approve OFF - graylist tools require approval'
  });
});

/**
 * POST /v1/approval-mode
 *
 * Toggle approval mode for the session
 *
 * Request body:
 * {
 *   autoApproveActions: boolean
 * }
 *
 * Response:
 * {
 *   success: true,
 *   autoApproveActions: boolean
 * }
 */
approvalRouter.post('/v1/approval-mode', (req: Request, res: Response) => {
  const serverOrchestrator = getServerOrchestrator();

  if (!serverOrchestrator) {
    return res.status(503).json({
      error: {
        message: 'Orchestrator not initialized',
        type: 'service_unavailable'
      }
    });
  }

  const { autoApproveActions } = req.body;

  // Validate input
  if (typeof autoApproveActions !== 'boolean') {
    return res.status(400).json({
      error: {
        message: 'autoApproveActions must be boolean',
        type: 'invalid_request_error'
      }
    });
  }

  // Cannot change approval mode in YOLO mode
  if (process.env.YOLO === 'true') {
    return res.status(400).json({
      error: {
        message: 'Cannot toggle approval mode in YOLO mode (all permissions bypassed)',
        type: 'invalid_request_error'
      }
    });
  }

  // Update approval mode
  serverOrchestrator.setApprovalMode({ autoApproveActions });

  res.json({
    success: true,
    autoApproveActions,
    message: `Auto-approve actions ${autoApproveActions ? 'enabled' : 'disabled'}`
  });
});
