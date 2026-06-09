/**
 * MCP Management Routes
 * Exposes MCP server management operations
 */
import { Router, Request, Response } from 'express';
import { getServerOrchestrator } from './messages.js';

export const mcpRouter = Router();

/**
 * GET /mcp/servers
 * List all MCP servers with their status
 */
mcpRouter.get('/mcp/servers', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    // Check if MCP is enabled
    const mcpEnabled = (orchestrator as any).isMcpEnabled?.() ?? false;
    if (!mcpEnabled) {
      return res.json({
        enabled: false,
        servers: []
      });
    }

    // Get server info
    const serverInfo = (orchestrator as any).getMcpServerInfo?.() ?? [];

    res.json({
      enabled: true,
      servers: serverInfo
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /mcp/servers/:name
 * Get specific MCP server details
 */
mcpRouter.get('/mcp/servers/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const mcpEnabled = (orchestrator as any).isMcpEnabled?.() ?? false;
    if (!mcpEnabled) {
      return res.status(404).json({
        error: { message: 'MCP not enabled', type: 'not_found' }
      });
    }

    const serverInfo = (orchestrator as any).getMcpServerInfo?.() ?? [];
    const server = serverInfo.find((s: any) => s.name === name);

    if (!server) {
      return res.status(404).json({
        error: { message: `MCP server ${name} not found`, type: 'not_found' }
      });
    }

    res.json(server);
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /mcp/servers/:name/tools
 * Get tools provided by a specific MCP server
 */
mcpRouter.get('/mcp/servers/:name/tools', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const mcpEnabled = (orchestrator as any).isMcpEnabled?.() ?? false;
    if (!mcpEnabled) {
      return res.status(404).json({
        error: { message: 'MCP not enabled', type: 'not_found' }
      });
    }

    // Get all MCP tools
    const allMcpTools = (orchestrator as any).getMcpTools?.() ?? [];

    // Filter tools from this server
    const serverTools = allMcpTools.filter((t: any) => t.serverName === name);

    res.json({
      serverName: name,
      toolCount: serverTools.length,
      tools: serverTools
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /mcp/tools
 * Get all MCP tools across all servers
 */
mcpRouter.get('/mcp/tools', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const mcpEnabled = (orchestrator as any).isMcpEnabled?.() ?? false;
    if (!mcpEnabled) {
      return res.json({
        enabled: false,
        tools: []
      });
    }

    const allMcpTools = (orchestrator as any).getMcpTools?.() ?? [];

    res.json({
      enabled: true,
      toolCount: allMcpTools.length,
      tools: allMcpTools
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /mcp/servers/:name/connect
 * Connect to an MCP server
 */
mcpRouter.post('/mcp/servers/:name/connect', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const mcpManager = (orchestrator as any).mcpManager;
    if (!mcpManager) {
      return res.status(503).json({
        error: { message: 'MCP not enabled', type: 'server_error' }
      });
    }

    // Connect to server
    await mcpManager.connectToServer(name);

    // Discover tools
    await mcpManager.discoverAll();

    res.json({
      success: true,
      message: `Connected to MCP server: ${name}`
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * POST /mcp/servers/:name/disconnect
 * Disconnect from an MCP server
 */
mcpRouter.post('/mcp/servers/:name/disconnect', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const orchestrator = getServerOrchestrator();

    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const mcpManager = (orchestrator as any).mcpManager;
    if (!mcpManager) {
      return res.status(503).json({
        error: { message: 'MCP not enabled', type: 'server_error' }
      });
    }

    // Disconnect from server
    await mcpManager.disconnectFromServer(name);

    res.json({
      success: true,
      message: `Disconnected from MCP server: ${name}`
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /mcp/status
 * Get overall MCP status
 */
mcpRouter.get('/mcp/status', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' }
      });
    }

    const mcpEnabled = (orchestrator as any).isMcpEnabled?.() ?? false;

    if (!mcpEnabled) {
      return res.json({
        enabled: false,
        serverCount: 0,
        connectedCount: 0,
        toolCount: 0
      });
    }

    const serverInfo = (orchestrator as any).getMcpServerInfo?.() ?? [];
    const connectedCount = serverInfo.filter((s: any) => s.status === 'connected').length;
    const allMcpTools = (orchestrator as any).getMcpTools?.() ?? [];

    res.json({
      enabled: true,
      serverCount: serverInfo.length,
      connectedCount,
      toolCount: allMcpTools.length,
      servers: serverInfo.map((s: any) => ({
        name: s.name,
        status: s.status,
        toolCount: s.toolCount,
        lastError: s.lastError
      }))
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});
