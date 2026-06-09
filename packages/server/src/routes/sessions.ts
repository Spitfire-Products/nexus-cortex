/**
 * Session Management Routes
 * Exposes session CRUD operations and checkpoint management
 */
import { Router, Request, Response } from 'express';
import { getServerOrchestrator } from './messages.js';

export const sessionsRouter = Router();

/**
 * POST /sessions/new
 * Create a new session
 */
sessionsRouter.post('/sessions/new', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const { modelId, projectPath } = req.body;
    const model = modelId || process.env.DEFAULT_MODEL_ID || 'gemini-2.5-flash';
    // Default to PROJECT_ROOT (monorepo root, set at server startup) for consistency
    // with /v1/messages and /sessions/:id/load. Using process.cwd() here was causing
    // metadata to be written to .cortex/sessions/<hash-of-packages-server>/ while
    // resume read from .cortex/sessions/<hash-of-monorepo-root>/, silently dropping
    // chain state + accumulated cache metrics across session restarts.
    const path = projectPath || process.env.PROJECT_ROOT || process.cwd();

    // Create new session (this will save the old one and start fresh)
    await orchestrator.createSession(path, model);

    // Get the new session info
    const currentModel = orchestrator.getCurrentModel();
    const sessionId = (orchestrator as any).currentSessionId;

    res.json({
      success: true,
      sessionId: sessionId || 'unknown',
      model: {
        id: currentModel.id,
        name: currentModel.displayName,
        provider: currentModel.provider,
        contextWindow: currentModel.limits.contextWindow
      },
      created: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions
 * List all sessions
 */
sessionsRouter.get('/sessions', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Access JSONLHistoryStore from orchestrator
    const historyStore = (orchestrator as any).historyStore;
    if (!historyStore) {
      return res.status(500).json({
        error: { message: 'History store not available', type: 'server_error' }
      });
    }

    const sessions = await historyStore.listSessions();
    res.json({ sessions });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions/:id
 * Get session details
 */
sessionsRouter.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const historyStore = (orchestrator as any).historyStore;
    if (!historyStore) {
      return res.status(500).json({
        error: { message: 'History store not available', type: 'server_error' }
      });
    }

    const sessionInfo = await historyStore.getSessionInfo(id);
    if (!sessionInfo) {
      return res.status(404).json({
        error: { message: `Session ${id} not found`, type: 'not_found' }
      });
    }

    res.json(sessionInfo);
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions/:id/messages
 * Get all messages from a session
 */
sessionsRouter.get('/sessions/:id/messages', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const historyStore = (orchestrator as any).historyStore;
    if (!historyStore) {
      return res.status(500).json({
        error: { message: 'History store not available', type: 'server_error' }
      });
    }

    const messages = await historyStore.loadSession(id);
    res.json({ messages });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions/:id/export
 * Export session to JSON
 */
sessionsRouter.get('/sessions/:id/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const historyStore = (orchestrator as any).historyStore;
    if (!historyStore) {
      return res.status(500).json({
        error: { message: 'History store not available', type: 'server_error' }
      });
    }

    const sessionInfo = await historyStore.getSessionInfo(id);
    if (!sessionInfo) {
      return res.status(404).json({
        error: { message: `Session ${id} not found`, type: 'not_found' }
      });
    }

    const messages = await historyStore.loadSession(id);

    res.json({
      sessionId: id,
      metadata: sessionInfo.metadata,
      messageCount: sessionInfo.messageCount,
      messages
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * DELETE /sessions/:id
 * Delete a session
 */
sessionsRouter.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const historyStore = (orchestrator as any).historyStore;
    if (!historyStore) {
      return res.status(500).json({
        error: { message: 'History store not available', type: 'server_error' }
      });
    }

    const deleted = await historyStore.deleteSession(id);
    if (!deleted) {
      return res.status(404).json({
        error: { message: `Session ${id} not found`, type: 'not_found' }
      });
    }

    res.json({ success: true, sessionId: id });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions/:id/checkpoints
 * List all checkpoints for a session
 */
sessionsRouter.get('/sessions/:id/checkpoints', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const checkpointManager = (orchestrator as any).checkpointManager;
    if (!checkpointManager) {
      return res.status(500).json({
        error: { message: 'Checkpoint manager not available', type: 'server_error' }
      });
    }

    const checkpoints = checkpointManager.listCheckpoints();
    res.json({ checkpoints });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /sessions/:id/load
 * Switch to a different session (load its history into the orchestrator)
 */
sessionsRouter.post('/sessions/:id/load', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const projectPath = process.env.PROJECT_ROOT || process.cwd();
    const result = await orchestrator.resumeSession(id, projectPath);

    res.json({
      success: true,
      sessionId: id,
      messageCount: result.messageCount,
      modelId: result.modelId,
      conversationId: result.conversationId
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /sessions/:id/resume
 * Resume from a checkpoint
 */
sessionsRouter.post('/sessions/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { checkpointId } = req.body;

    if (!checkpointId) {
      return res.status(400).json({
        error: { message: 'checkpointId is required', type: 'invalid_request' }
      });
    }

    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const checkpointManager = (orchestrator as any).checkpointManager;
    if (!checkpointManager) {
      return res.status(500).json({
        error: { message: 'Checkpoint manager not available', type: 'server_error' }
      });
    }

    const result = await checkpointManager.resumeFromCheckpoint(checkpointId, {
      sessionId: id
    });

    res.json({
      success: true,
      checkpoint: result.checkpoint,
      conversation: result.conversation,
      messageCount: result.messages.length
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions/:id/stats
 * Get session statistics
 */
sessionsRouter.get('/sessions/:id/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const historyStore = (orchestrator as any).historyStore;
    if (!historyStore) {
      return res.status(500).json({
        error: { message: 'History store not available', type: 'server_error' }
      });
    }

    const sessionInfo = await historyStore.getSessionInfo(id);
    if (!sessionInfo) {
      return res.status(404).json({
        error: { message: `Session ${id} not found`, type: 'not_found' }
      });
    }

    const messages = await historyStore.loadSession(id);

    // Calculate statistics
    const userMessages = messages.filter((m: any) => m.role === 'user').length;
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant').length;
    const toolUses = messages.filter((m: any) =>
      m.content && Array.isArray(m.content) &&
      m.content.some((c: any) => c.type === 'tool_use')
    ).length;

    // Calculate token usage (if available in messages)
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;

    for (const message of messages) {
      if ((message as any).usage) {
        const usage = (message as any).usage;
        totalInputTokens += usage.input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
        totalCacheReadTokens += usage.cache_read_input_tokens || 0;
        totalCacheWriteTokens += usage.cache_creation_input_tokens || 0;
      }
    }

    res.json({
      sessionId: id,
      metadata: sessionInfo.metadata,
      messageCount: sessionInfo.messageCount,
      userMessages,
      assistantMessages,
      turnCount: Math.min(userMessages, assistantMessages),
      toolUses,
      tokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
        cacheRead: totalCacheReadTokens,
        cacheWrite: totalCacheWriteTokens,
        total: totalInputTokens + totalOutputTokens + totalCacheReadTokens
      },
      fileSize: sessionInfo.fileSize,
      created: sessionInfo.metadata.startTime,
      lastModified: sessionInfo.lastModified
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /sessions/:id/model
 * Switch to a different model
 */
sessionsRouter.post('/sessions/:id/model', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { modelId, reason } = req.body;

    if (!modelId) {
      return res.status(400).json({
        error: { message: 'modelId is required', type: 'invalid_request' }
      });
    }

    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Switch model
    await orchestrator.switchModel(modelId, { reason });

    // Get current model info
    const currentModel = orchestrator.getCurrentModel();

    res.json({
      success: true,
      sessionId: id,
      modelId: currentModel.id,
      modelName: currentModel.displayName,
      provider: currentModel.provider,
      contextWindow: currentModel.limits.contextWindow,
      reason
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions/:id/context
 * Get context budget status
 */
sessionsRouter.get('/sessions/:id/context', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const contextBudgetManager = (orchestrator as any).contextBudgetManager;
    if (!contextBudgetManager) {
      return res.status(500).json({
        error: { message: 'Context budget manager not available', type: 'server_error' }
      });
    }

    const currentModel = orchestrator.getCurrentModel();
    const budget = contextBudgetManager.calculateBudget(currentModel);

    // Estimate current token usage
    const messageHistory = orchestrator.getMessageHistory();
    let estimatedTokens = 0;
    try {
      // Estimate total tokens from message history
      estimatedTokens = contextBudgetManager['estimateTotalTokens'](messageHistory, currentModel);
    } catch (e) {
      // Fallback: rough estimation
      estimatedTokens = Math.floor(JSON.stringify(messageHistory).length / 4);
    }

    const utilization = budget.maxTokens > 0 ? (estimatedTokens / budget.maxTokens) * 100 : 0;

    res.json({
      sessionId: id,
      model: {
        id: currentModel.id,
        name: currentModel.displayName,
        contextWindow: currentModel.limits.contextWindow
      },
      budget: {
        maxTokens: budget.maxTokens,
        reservedForOutput: budget.reservedForOutput,
        availableForInput: budget.availableForInput,
        systemMessageAllocation: budget.systemMessageAllocation
      },
      usage: {
        estimatedTokens,
        utilization: Math.round(utilization * 100) / 100,
        remaining: Math.max(0, budget.availableForInput - estimatedTokens)
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions/:id/cache/metrics
 * Get cache metrics for session
 */
sessionsRouter.get('/sessions/:id/cache/metrics', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const currentSessionId = orchestrator.getSessionId();

    // If requesting current session, get live metrics from orchestrator
    if (id === currentSessionId) {
      const metrics = orchestrator.getCacheMetrics();
      const report = orchestrator.getCacheReport();

      return res.json({
        sessionId: id,
        metrics,
        report,
        timestamp: new Date().toISOString()
      });
    }

    // For historical sessions, load from session metadata file
    const historyStore = (orchestrator as any).historyStore;
    if (!historyStore) {
      return res.status(500).json({
        error: { message: 'History store not available', type: 'server_error' }
      });
    }

    const metadata = await historyStore.loadMetadata(id);
    if (!metadata || !metadata.cacheMetrics) {
      return res.json({
        sessionId: id,
        metrics: null,
        report: 'No cache metrics available for this session',
        timestamp: new Date().toISOString()
      });
    }

    // Generate report from saved metrics
    const m = metadata.cacheMetrics;
    const reportLines = [
      '=== Cache Performance Report ===\n',
      `Total Requests: ${m.requestCount}`,
      `Requests with Cache Hits: ${m.requestsWithCacheHits}\n`,
      `Total Input Tokens: ${m.totalInputTokens.toLocaleString()}`,
      ` - Cache Creation: ${m.totalCacheCreationTokens.toLocaleString()}`,
      ` - Cache Reads: ${m.totalCacheReadTokens.toLocaleString()} (${(m.overallCacheHitRate * 100).toFixed(1)}%)`,
      ` - Uncached: ${m.totalUncachedInputTokens.toLocaleString()}\n`,
      `Total Output Tokens: ${m.totalOutputTokens.toLocaleString()}\n`,
      `Overall Cache Hit Rate: ${(m.overallCacheHitRate * 100).toFixed(1)}%`,
      `Estimated Cost Savings: ${(m.overallCostSavingsRatio * 100).toFixed(1)}%`
    ];

    if (Object.keys(m.byProvider || {}).length > 0) {
      reportLines.push('\n=== By Provider ===');
      for (const [provider, pm] of Object.entries(m.byProvider) as [string, any][]) {
        reportLines.push(`\n${provider}:`);
        reportLines.push(` Requests: ${pm.requestCount}`);
        reportLines.push(` Cache Reads: ${pm.cacheReadTokens.toLocaleString()}`);
        if (pm.cacheCreationTokens > 0) {
          reportLines.push(` Cache Creation: ${pm.cacheCreationTokens.toLocaleString()}`);
        }
        reportLines.push(` Hit Rate: ${(pm.cacheHitRate * 100).toFixed(1)}%`);
      }
    }

    res.json({
      sessionId: id,
      metrics: metadata.cacheMetrics,
      report: reportLines.join('\n'),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /sessions/:id/compaction
 * Trigger manual compaction
 */
sessionsRouter.post('/sessions/:id/compaction', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { strategy } = req.body; // optional: 'aggressive', 'conservative', etc.

    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const compactionManager = (orchestrator as any).compactionManager;
    if (!compactionManager) {
      return res.status(500).json({
        error: { message: 'Compaction manager not available', type: 'server_error' }
      });
    }

    // Trigger manual compaction
    // Note: This is a placeholder - actual implementation depends on compactionManager API
    const result = await compactionManager.performManualCompaction?.(strategy);

    res.json({
      success: true,
      sessionId: id,
      strategy: strategy || 'default',
      result: result || { message: 'Compaction triggered' }
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /sessions/:id/compaction/boundaries
 * Get compaction boundaries
 */
sessionsRouter.get('/sessions/:id/compaction/boundaries', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const compactionManager = (orchestrator as any).compactionManager;
    if (!compactionManager) {
      return res.status(500).json({
        error: { message: 'Compaction manager not available', type: 'server_error' }
      });
    }

    // Get compaction boundaries
    const boundaries = await compactionManager.getCompactionBoundaries?.();

    res.json({
      sessionId: id,
      boundaries: boundaries || [],
      count: boundaries?.length || 0
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});
