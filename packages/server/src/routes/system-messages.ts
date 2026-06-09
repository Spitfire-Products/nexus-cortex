/**
 * System Messages Routes
 * Exposes system message management (read-only for now)
 */
import { Router, Request, Response } from 'express';
import { getServerOrchestrator } from './messages.js';

export const systemMessagesRouter = Router();

/**
 * GET /system-messages
 * List all system messages
 */
systemMessagesRouter.get('/system-messages', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const systemMessageLoader = (orchestrator as any).systemMessageLoader;
    if (!systemMessageLoader) {
      return res.status(500).json({
        error: { message: 'System message loader not available', type: 'server_error' }
      });
    }

    // Get list of system messages
    const messages = systemMessageLoader.listMessages?.() || [];

    res.json({
      messages,
      count: messages.length
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /system-messages/:id
 * Get specific system message
 */
systemMessagesRouter.get('/system-messages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const systemMessageLoader = (orchestrator as any).systemMessageLoader;
    if (!systemMessageLoader) {
      return res.status(500).json({
        error: { message: 'System message loader not available', type: 'server_error' }
      });
    }

    // Get specific message
    const message = systemMessageLoader.getMessage?.(id);
    if (!message) {
      return res.status(404).json({
        error: { message: `System message not found: ${id}`, type: 'not_found' }
      });
    }

    res.json({
      id,
      message
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /system-messages/reload
 * Reload system messages from disk
 */
systemMessagesRouter.post('/system-messages/reload', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const systemMessageLoader = (orchestrator as any).systemMessageLoader;
    if (!systemMessageLoader) {
      return res.status(500).json({
        error: { message: 'System message loader not available', type: 'server_error' }
      });
    }

    // Reload messages
    await systemMessageLoader.reload?.();

    res.json({
      success: true,
      message: 'System messages reloaded successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /system-messages
 * Create a new system message (not implemented - file-based)
 */
systemMessagesRouter.post('/system-messages', async (req: Request, res: Response) => {
  res.status(501).json({
    error: {
      message: 'System message creation not implemented',
      type: 'not_implemented',
      details: 'System messages are file-based. Create a .md file in the system-messages directory instead.'
    }
  });
});

/**
 * PUT /system-messages/:id
 * Update a system message (not implemented - file-based)
 */
systemMessagesRouter.put('/system-messages/:id', async (req: Request, res: Response) => {
  res.status(501).json({
    error: {
      message: 'System message update not implemented',
      type: 'not_implemented',
      details: 'System messages are file-based. Edit the .md file directly instead.'
    }
  });
});

/**
 * DELETE /system-messages/:id
 * Delete a system message (not implemented - file-based)
 */
systemMessagesRouter.delete('/system-messages/:id', async (req: Request, res: Response) => {
  res.status(501).json({
    error: {
      message: 'System message deletion not implemented',
      type: 'not_implemented',
      details: 'System messages are file-based. Delete the .md file directly instead.'
    }
  });
});
