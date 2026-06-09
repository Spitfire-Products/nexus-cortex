/**
 * Tools Routes
 * Exposes available tool definitions
 */
import { Router, Request, Response } from 'express';
import { toolFactory } from '@nexus-cortex/core';

export const toolsRouter = Router();

/**
 * GET /tools
 * List all available tools
 */
toolsRouter.get('/tools', async (req: Request, res: Response) => {
  try {
    // Get all tools from the tool factory
    const tools = toolFactory.getAllTools();

    // Transform to API format
    const toolsList = tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.schema,
      category: tool.category || 'general'
    }));

    // Group by category if requested
    const { grouped } = req.query;
    if (grouped === 'true') {
      const byCategory: Record<string, any[]> = {};
      for (const tool of toolsList) {
        const category = tool.category;
        if (!byCategory[category]) {
          byCategory[category] = [];
        }
        byCategory[category].push(tool);
      }

      return res.json({
        tools: toolsList,
        grouped: byCategory,
        totalCount: toolsList.length,
        categories: Object.keys(byCategory)
      });
    }

    res.json({
      tools: toolsList,
      totalCount: toolsList.length
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});

/**
 * GET /tools/:name
 * Get specific tool details
 */
toolsRouter.get('/tools/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const tools = toolFactory.getAllTools();
    const tool = tools.find((t: any) => t.name === name);

    if (!tool) {
      return res.status(404).json({
        error: { message: `Tool not found: ${name}`, type: 'not_found' }
      });
    }

    res.json({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.schema,
      category: (tool as any).category || 'general'
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' }
    });
  }
});
