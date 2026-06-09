/**
 * ConfigureMcpServer Tool
 *
 * Allows models to update configuration for existing MCP servers
 * (args, env, timeout, auto-start, etc.) in MCP_CONFIG.md.
 *
 * Phase 2.6: MCP Model Management Tools
 */

import type { CanonicalTool } from '../types/CanonicalTool.js';
import type { McpConfigManager } from '../../mcp/McpConfigManager.js';

export interface ConfigureMcpServerInput {
  server_name: string;
  description?: string;
  args?: string[];
  env?: Record<string, string>;
  auto_start?: boolean;
  timeout?: number;
}

export interface ConfigureMcpServerOutput {
  status: 'success' | 'not_found' | 'error';
  server: string;
  message: string;
  configUpdated: boolean;
  changes?: Record<string, any>;
}

export class ConfigureMcpServer {
  /**
   * Execute the configure_mcp_server tool
   *
   * @param input Tool input parameters
   * @param configManager MCP config manager
   * @param projectPath Project path for config location
   * @returns Result of configuring the server
   */
  static async execute(
    input: ConfigureMcpServerInput,
    configManager: McpConfigManager,
    _projectPath: string
  ): Promise<ConfigureMcpServerOutput> {
    // 1. Read current config
    const projectConfig = await configManager.readConfig('project');

    if (!projectConfig) {
      return {
        status: 'not_found',
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
        server: input.server_name,
        message: `Server "${input.server_name}" not found in MCP_CONFIG.md. Use enable_mcp_server to add it first.`,
        configUpdated: false
      };
    }

    // 3. Track changes
    const changes: Record<string, any> = {};
    const server = projectConfig.servers[serverIndex];

    if (!server) {
      return {
        status: 'not_found',
        server: input.server_name,
        message: `Server "${input.server_name}" not found at index in config.`,
        configUpdated: false
      };
    }

    // 4. Apply updates
    if (input.description !== undefined && input.description !== server.description) {
      changes.description = input.description;
      server.description = input.description;
    }

    if (input.args !== undefined && JSON.stringify(input.args) !== JSON.stringify(server.args)) {
      changes.args = input.args;
      server.args = input.args;
    }

    if (input.env !== undefined) {
      // Merge env vars
      const oldEnv = JSON.stringify(server.env || {});
      const newEnv = { ...(server.env || {}), ...input.env };
      if (JSON.stringify(newEnv) !== oldEnv) {
        changes.env = input.env;
        server.env = newEnv;
      }
    }

    if (input.auto_start !== undefined && input.auto_start !== server.autoStart) {
      changes.auto_start = input.auto_start;
      server.autoStart = input.auto_start;
    }

    if (input.timeout !== undefined && input.timeout !== server.timeout) {
      changes.timeout = input.timeout;
      server.timeout = input.timeout;
    }

    // 5. Check if any changes were made
    if (Object.keys(changes).length === 0) {
      return {
        status: 'success',
        server: input.server_name,
        message: `No changes needed for "${input.server_name}". Configuration is already as specified.`,
        configUpdated: false,
        changes: {}
      };
    }

    // 6. Write updated config
    try {
      await configManager.writeConfig('project', projectConfig);

      return {
        status: 'success',
        server: input.server_name,
        message: `Successfully updated configuration for "${input.server_name}". Changes: ${Object.keys(changes).join(', ')}. Note: Server will need to reconnect for changes to take effect.`,
        configUpdated: true,
        changes
      };
    } catch (error) {
      return {
        status: 'error',
        server: input.server_name,
        message: `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`,
        configUpdated: false
      };
    }
  }

  /**
   * Convert to canonical tool format for registration
   */
  static toCanonicalTool(): CanonicalTool {
    return {
      name: 'ConfigureMcpServer',
      description: 'Update configuration for an existing MCP server (args, env, timeout, auto-start, etc.). Server will need to reconnect for changes to take effect.',
      schema: {
        type: 'object',
        properties: {
          server_name: {
            type: 'string',
            description: 'Name of server to configure'
          },
          description: {
            type: 'string',
            description: 'Update server description'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Update command arguments'
          },
          env: {
            type: 'object',
            description: 'Update or add environment variables (merged with existing)'
          },
          auto_start: {
            type: 'boolean',
            description: 'Update auto-start setting'
          },
          timeout: {
            type: 'number',
            description: 'Update connection timeout in milliseconds'
          }
        },
        required: ['server_name']
      }
    };
  }
}
