/**
 * Middleware Configuration Routes
 * Exposes middleware configuration and management
 */
import { Router, Request, Response } from 'express';
import { getServerOrchestrator } from './messages.js';

export const middlewareRouter = Router();

/**
 * GET /middleware/config
 * Get middleware configuration
 */
middlewareRouter.get('/middleware/config', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Collect middleware status
    const middlewareStatus = {
      errorClassifier: !!(orchestrator as any).errorClassifier,
      retry: !!(orchestrator as any).retryMiddleware,
      permissions: !!(orchestrator as any).permissionsMiddleware,
      systemMessage: !!(orchestrator as any).systemMessageMiddleware,
      mentorship: !!(orchestrator as any).mentorshipMiddleware,
      helper: !!(orchestrator as any).helperMiddleware
    };

    // Get config from each middleware if available
    const config: Record<string, any> = {};

    if ((orchestrator as any).retryMiddleware) {
      config.retry = {
        enabled: true,
        maxRetries: (orchestrator as any).retryMiddleware.maxRetries || 3
      };
    }

    if ((orchestrator as any).permissionsMiddleware) {
      config.permissions = {
        enabled: true,
        mode: orchestrator.getApprovalMode()
      };
    }

    if ((orchestrator as any).mentorshipMiddleware) {
      config.mentorship = {
        enabled: !!(orchestrator as any).config.reactiveMentorship?.enabled
      };
    }

    res.json({
      middleware: middlewareStatus,
      config,
      enabledCount: Object.values(middlewareStatus).filter(Boolean).length
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /middleware/:name/enable
 * Enable a middleware component
 */
middlewareRouter.post('/middleware/:name/enable', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    return res.status(501).json({
      error: {
        message: 'Middleware enable/disable requires server restart',
        type: 'not_implemented',
        details: 'Middleware components are configured at server startup and cannot be dynamically enabled'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /middleware/:name/disable
 * Disable a middleware component
 */
middlewareRouter.post('/middleware/:name/disable', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    return res.status(501).json({
      error: {
        message: 'Middleware enable/disable requires server restart',
        type: 'not_implemented',
        details: 'Middleware components are configured at server startup and cannot be dynamically disabled'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /middleware/:name/status
 * Get status of a specific middleware
 */
middlewareRouter.get('/middleware/:name/status', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Map friendly names to internal properties
    const middlewareMap: Record<string, string> = {
      'error-classifier': 'errorClassifier',
      'retry': 'retryMiddleware',
      'permissions': 'permissionsMiddleware',
      'system-message': 'systemMessageMiddleware',
      'mentorship': 'mentorshipMiddleware',
      'helper': 'helperMiddleware'
    };

    const internalName = middlewareMap[name] || name;
    const middleware = (orchestrator as any)[internalName];

    if (!middleware) {
      return res.json({
        name,
        enabled: false,
        message: `Middleware '${name}' is not enabled or does not exist`
      });
    }

    res.json({
      name,
      enabled: true,
      internalName,
      config: middleware.getConfig?.() || {}
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});
