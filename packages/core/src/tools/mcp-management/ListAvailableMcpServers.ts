/**
 * ListAvailableMcpServers Tool
 *
 * Allows models to discover MCP servers available in the community registry.
 * Shows server capabilities, requirements, and current enablement status.
 *
 * Phase 2.6: MCP Model Management Tools
 */

import type { CanonicalTool } from '../types/CanonicalTool.js';
import type { McpServerRegistry, McpServerDefinition } from '../../mcp/McpServerRegistry.js';
import type { McpConfigManager } from '../../mcp/McpConfigManager.js';

export interface ListAvailableMcpServersInput {
  category?: 'filesystem' | 'database' | 'browser' | 'api' | 'development' | 'productivity' | 'custom';
  verified_only?: boolean;
}

export interface ListAvailableMcpServersOutput {
  servers: Array<{
    name: string;
    displayName: string;
    description: string;
    category: string;
    verified: boolean;
    capabilities?: string[];
    recommendedFor?: string[];
    npmPackage?: string;
    requiredEnv?: string[];
    autoStartSupported: boolean;
    currentlyEnabled: boolean;
    currentlyConnected?: boolean;
  }>;
  total: number;
  filtered: number;
}

export class ListAvailableMcpServers {
  /**
   * Execute the list_available_mcp_servers tool
   *
   * @param input Tool input parameters
   * @param serverRegistry MCP server registry
   * @param configManager MCP config manager (to check enabled status)
   * @param connectedServers Set of currently connected server names
   * @returns List of available servers with metadata
   */
  static async execute(
    input: ListAvailableMcpServersInput,
    serverRegistry: McpServerRegistry,
    configManager: McpConfigManager,
    connectedServers: Set<string> = new Set()
  ): Promise<ListAvailableMcpServersOutput> {
    // Get all servers or filter by category
    let servers: McpServerDefinition[];

    if (input.category) {
      servers = serverRegistry.getServersByCategory(input.category);
    } else {
      servers = serverRegistry.getAllServers();
    }

    // Filter by verified status if requested
    if (input.verified_only !== false) { // Default to true
      servers = servers.filter(s => s.verified);
    }

    // Check which servers are currently enabled
    const enabledServers = new Set<string>();
    try {
      const projectConfig = await configManager.readConfig('project');
      const globalConfig = await configManager.readConfig('global');
      const mergedConfig = configManager.mergeConfigs(projectConfig, globalConfig);

      if (mergedConfig) {
        mergedConfig.servers
          .filter(s => s.status === 'enabled')
          .forEach(s => enabledServers.add(s.name));
      }
    } catch (error) {
      // Config doesn't exist or can't be read - no servers enabled
    }

    // Transform to output format
    const serverList = servers.map(server => ({
      name: server.name,
      displayName: server.displayName,
      description: server.description,
      category: server.category,
      verified: server.verified,
      capabilities: server.capabilities,
      recommendedFor: server.recommendedFor,
      npmPackage: server.npmPackage,
      requiredEnv: server.requiredEnv,
      autoStartSupported: true, // All servers support auto-start
      currentlyEnabled: enabledServers.has(server.name),
      currentlyConnected: connectedServers.has(server.name)
    }));

    return {
      servers: serverList,
      total: serverRegistry.getServerCount(),
      filtered: serverList.length
    };
  }

  /**
   * Convert to canonical tool format for registration
   */
  static toCanonicalTool(): CanonicalTool {
    return {
      name: 'ListAvailableMcpServers',
      description: 'List all MCP servers available in the community registry with their descriptions, capabilities, and requirements. Use this to discover what tools are available to enable.',
      schema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Optional: Filter by category (filesystem, database, browser, api, development, productivity, custom)',
            enum: ['filesystem', 'database', 'browser', 'api', 'development', 'productivity', 'custom']
          },
          verified_only: {
            type: 'boolean',
            description: 'Only show verified community servers (default: true)'
          }
        }
      }
    };
  }
}
