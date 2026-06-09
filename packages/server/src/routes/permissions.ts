/**
 * Permissions Routes
 * Exposes permission management for tools
 *
 * Updated to use orchestrator public methods (following direct-wired pattern)
 */
import { Router, Request, Response } from 'express';
import { getServerOrchestrator } from './messages.js';
import { WhitelistPolicy, BlacklistPolicy } from '@nexus-cortex/core';

export const permissionsRouter = Router();

/**
 * GET /permissions/policies
 * List permission policies
 */
permissionsRouter.get('/permissions/policies', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Use orchestrator public method
    const policies = orchestrator.getPolicies();

    res.json({
      policies,
      count: policies.length
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /permissions/tool/:name
 * Grant permission for a tool (creates WhitelistPolicy)
 */
permissionsRouter.post('/permissions/tool/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { action } = req.body;

    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    if (action === 'grant' || !action) {
      // Create WhitelistPolicy for this tool
      const policy = new WhitelistPolicy([name], 40);
      orchestrator.registerPolicy(policy);

      res.json({
        success: true,
        tool: name,
        action: 'grant',
        message: `Permission granted for tool: ${name}`
      });
    } else if (action === 'revoke') {
      // Create BlacklistPolicy for this tool
      const policy = new BlacklistPolicy([name], 100);
      orchestrator.registerPolicy(policy);

      res.json({
        success: true,
        tool: name,
        action: 'revoke',
        message: `Permission revoked for tool: ${name}`
      });
    } else {
      return res.status(400).json({
        error: {
          message: 'action must be "grant" or "revoke"',
          type: 'invalid_request'
        }
      });
    }
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * DELETE /permissions/tool/:name
 * Revoke permission for a tool (creates BlacklistPolicy)
 */
permissionsRouter.delete('/permissions/tool/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Create BlacklistPolicy for this tool
    const policy = new BlacklistPolicy([name], 100);
    orchestrator.registerPolicy(policy);

    res.json({
      success: true,
      tool: name,
      message: `Permission revoked for tool: ${name}`
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /permissions/audit/statistics
 * Get audit statistics (must come before /:sessionId route)
 */
permissionsRouter.get('/permissions/audit/statistics', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Use orchestrator public method
    const statistics = await orchestrator.getAuditStatistics();

    res.json(statistics || { message: 'No statistics available' });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /permissions/audit
 * GET /permissions/audit/:sessionId
 * Get audit log entries
 */
permissionsRouter.get('/permissions/audit/:sessionId?', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Use orchestrator public method
    const entries = orchestrator.getAuditLog(sessionId);

    res.json({
      entries,
      count: entries.length,
      sessionId: sessionId || orchestrator.getSessionId()
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /permissions/denied
 * Get all denied operations
 */
permissionsRouter.get('/permissions/denied', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Use orchestrator public method
    const operations = await orchestrator.getAllDeniedOperations();

    res.json({
      operations,
      count: operations.length
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /permissions/policies
 * Register a custom permission policy
 */
permissionsRouter.post('/permissions/policies', async (req: Request, res: Response) => {
  try {
    const { policy } = req.body;

    if (!policy) {
      return res.status(400).json({
        error: {
          message: 'policy object required in request body',
          type: 'invalid_request'
        }
      });
    }

    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Use orchestrator public method
    orchestrator.registerPolicy(policy);

    res.json({
      success: true,
      message: `Policy registered: ${policy.name}`
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * DELETE /permissions/policies/:policyName
 * Unregister a permission policy
 */
permissionsRouter.delete('/permissions/policies/:policyName', async (req: Request, res: Response) => {
  try {
    const { policyName } = req.params;

    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Use orchestrator public method
    const removed = orchestrator.unregisterPolicy(policyName);

    res.json({
      success: removed,
      removed,
      message: removed
        ? `Policy unregistered: ${policyName}`
        : `Policy not found: ${policyName}`
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});
