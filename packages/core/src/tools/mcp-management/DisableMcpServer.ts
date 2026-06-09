/**
 * DisableMcpServer Tool
 *
 * Allows models to disable MCP servers by updating their status in MCP_CONFIG.md
 * or completely removing them from the configuration.
 *
 * Phase 2.6: MCP Model Management Tools
 */

import type { CanonicalTool } from '../types/CanonicalTool.js';
import type { McpConfigManager } from '../../mcp/McpConfigManager.js';

export interface DisableMcpServerInput {
  server_name: string;
  remove?: boolean;
}

export interface DisableMcpServerOutput {
  status: 'success' | 'not_found' | 'error';
  action: 'disabled' | 'removed';
  server: string;
  message: string;
  configUpdated: boolean;
  wasConnected?: boolean;
}

export class DisableMcpServer {
  /**
   * Execute the disable_mcp_server tool
   *
   * @param input Tool input parameters
   * @param configManager MCP config manager
   * @param projectPath Project path for config location
   * @param connectedServers Set of currently connected server names
   * @returns Result of disabling the server
   */
  static async execute(
    input: DisableMcpServerInput,
    configManager: McpConfigManager,
    _projectPath: string,
    connectedServers: Set<string> = new Set()
  ): Promise<DisableMcpServerOutput> {
    const wasConnected = connectedServers.has(input.server_name);

    // 1. Read current config
    const projectConfig = await configManager.readConfig('project');

    if (!projectConfig) {
      return {
        status: 'not_found',
        action: 'disabled',
        server: input.server_name,
        message: `No MCP_CONFIG.md found in project. Server "${input.server_name}" is not configured.`,
        configUpdated: false
      };
    }

    // 2. Find server in config
    const serverIndex = projectConfig.servers.findIndex(s => s.name === input.server_name);

    if (serverIndex === -1) {
      return {
        status: 'not_found',
        action: 'disabled',
        server: input.server_name,
        message: `Server "${input.server_name}" not found in MCP_CONFIG.md. It may already be disabled or was never enabled.`,
        configUpdated: false
      };
    }

    // 3. Either remove or disable the server
    try {
      if (input.remove) {
        // Completely remove from config
        projectConfig.servers.splice(serverIndex, 1);

        await configManager.writeConfig('project', projectConfig);

        return {
          status: 'success',
          action: 'removed',
          server: input.server_name,
          message: `Successfully removed "${input.server_name}" from MCP_CONFIG.md.${wasConnected ? ' Server has been disconnected.' : ''}`,
          configUpdated: true,
          wasConnected
        };
      } else {
        // Just disable it
        if (projectConfig.servers[serverIndex]) {
          projectConfig.servers[serverIndex].status = 'disabled';
        }

        await configManager.writeConfig('project', projectConfig);

        return {
          status: 'success',
          action: 'disabled',
          server: input.server_name,
          message: `Successfully disabled "${input.server_name}" in MCP_CONFIG.md.${wasConnected ? ' Server has been disconnected.' : ''} Use enable_mcp_server to re-enable.`,
          configUpdated: true,
          wasConnected
        };
      }
    } catch (error) {
      return {
        status: 'error',
        action: 'disabled',
        server: input.server_name,
        message: `Failed to disable server: ${error instanceof Error ? error.message : String(error)}`,
        configUpdated: false
      };
    }
  }

  /**
   * Convert to canonical tool format for registration
   */
  static toCanonicalTool(): CanonicalTool {
    return {
      name: 'DisableMcpServer',
      description: 'Disable an MCP server by setting its status to disabled in MCP_CONFIG.md. This disconnects the server and removes its tools from availability.',
      schema: {
        type: 'object',
        properties: {
          server_name: {
            type: 'string',
            description: 'Name of server to disable'
          },
          remove: {
            type: 'boolean',
            description: 'Completely remove from config instead of just marking disabled (default: false)'
          }
        },
        required: ['server_name']
      }
    };
  }
}
