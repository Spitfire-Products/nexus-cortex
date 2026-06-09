/**
 * GetMcpConfig Tool
 *
 * Allows models to read the current MCP_CONFIG.md and see enabled servers,
 * their settings, connection status, and available tools.
 *
 * Phase 2.6: MCP Model Management Tools
 */

import type { CanonicalTool } from '../types/CanonicalTool.js';
import type { McpConfigManager, McpConfigServerEntry } from '../../mcp/McpConfigManager.js';

export interface GetMcpConfigInput {
  include_disabled?: boolean;
}

export interface GetMcpConfigOutput {
  configExists: boolean;
  configPath: string | null;
  servers: Array<{
    name: string;
    status: 'enabled' | 'disabled';
    description?: string;
    transport?: 'stdio' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    autoStart: boolean;
    timeout?: number;
    connected?: boolean;
    toolCount?: number;
  }>;
  totalServers: number;
  enabledServers: number;
  connectedServers: number;
}

export class GetMcpConfig {
  /**
   * Execute the get_mcp_config tool
   *
   * @param input Tool input parameters
   * @param configManager MCP config manager
   * @param projectPath Project path for config location
   * @param connectedServers Map of server name to tool count
   * @returns Current MCP configuration
   */
  static async execute(
    input: GetMcpConfigInput,
    configManager: McpConfigManager,
    projectPath: string,
    connectedServers: Map<string, number> = new Map()
  ): Promise<GetMcpConfigOutput> {
    // Try to read project config first, then global
    const projectConfig = await configManager.readConfig('project');
    const globalConfig = await configManager.readConfig('global');
    const mergedConfig = configManager.mergeConfigs(projectConfig, globalConfig);

    // Determine config path
    let configPath: string | null = null;
    if (projectConfig) {
      configPath = `${projectPath}/MCP_CONFIG.md`;
    } else if (globalConfig) {
      configPath = '~/.cortex/MCP_CONFIG.md';
    }

    const configExists = mergedConfig !== null;

    if (!mergedConfig) {
      // No config exists
      return {
        configExists: false,
        configPath: null,
        servers: [],
        totalServers: 0,
        enabledServers: 0,
        connectedServers: 0
      };
    }

    // Filter servers based on include_disabled
    let servers: McpConfigServerEntry[] = mergedConfig.servers;
    if (!input.include_disabled) {
      servers = servers.filter(s => s.status === 'enabled');
    }

    // Transform to output format with connection status
    const serverList = servers.map(server => ({
      name: server.name,
      status: server.status as 'enabled' | 'disabled', // Config servers only have enabled/disabled, not available
      description: server.description,
      transport: server.transport,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      headers: server.headers,
      autoStart: server.autoStart ?? true,
      timeout: server.timeout,
      connected: connectedServers.has(server.name),
      toolCount: connectedServers.get(server.name)
    }));

    const enabledServers = servers.filter(s => s.status === 'enabled').length;
    const connectedCount = serverList.filter(s => s.connected).length;

    return {
      configExists,
      configPath,
      servers: serverList,
      totalServers: mergedConfig.servers.length,
      enabledServers,
      connectedServers: connectedCount
    };
  }

  /**
   * Convert to canonical tool format for registration
   */
  static toCanonicalTool(): CanonicalTool {
    return {
      name: 'GetMcpConfig',
      description: 'Get current MCP configuration showing enabled servers, their settings, connection status, and available tools. Use this to see what MCP servers are currently configured.',
      schema: {
        type: 'object',
        properties: {
          include_disabled: {
            type: 'boolean',
            description: 'Include disabled servers in output (default: false)'
          }
        }
      }
    };
  }
}
