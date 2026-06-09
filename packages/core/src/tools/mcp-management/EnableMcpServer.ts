/**
 * EnableMcpServer Tool
 *
 * Allows models to enable MCP servers by adding them to MCP_CONFIG.md.
 * Generates a diff preview for user confirmation before making changes.
 *
 * Phase 2.6: MCP Model Management Tools
 */

import type { CanonicalTool } from '../types/CanonicalTool.js';
import type { McpServerRegistry } from '../../mcp/McpServerRegistry.js';
import type { McpConfigManager, McpConfigServerEntry } from '../../mcp/McpConfigManager.js';

export interface EnableMcpServerInput {
  server_name: string;
  description?: string;
  args?: string[];
  env?: Record<string, string>;
  auto_start?: boolean;
  timeout?: number;
}

export interface EnableMcpServerOutput {
  status: 'success' | 'already_enabled' | 'not_found' | 'error';
  server?: {
    name: string;
    displayName: string;
    description: string;
  };
  message: string;
  configUpdated: boolean;
  configPath?: string;
  requiredEnv?: string[];
  toolsAdded?: number;
}

export class EnableMcpServer {
  /**
   * Execute the enable_mcp_server tool
   *
   * @param input Tool input parameters
   * @param serverRegistry MCP server registry
   * @param configManager MCP config manager
   * @param projectPath Project path for config location
   * @returns Result of enabling the server
   */
  static async execute(
    input: EnableMcpServerInput,
    serverRegistry: McpServerRegistry,
    configManager: McpConfigManager,
    projectPath: string
  ): Promise<EnableMcpServerOutput> {
    // 1. Look up server in registry
    const serverDef = serverRegistry.getServer(input.server_name);

    if (!serverDef) {
      return {
        status: 'not_found',
        message: `Server "${input.server_name}" not found in registry. Use list_available_mcp_servers to see available servers.`,
        configUpdated: false
      };
    }

    // 2. Check if already enabled
    const projectConfig = await configManager.readConfig('project');
    const globalConfig = await configManager.readConfig('global');
    const mergedConfig = configManager.mergeConfigs(projectConfig, globalConfig);

    const existingServer = mergedConfig?.servers.find(s => s.name === input.server_name);
    if (existingServer && existingServer.status === 'enabled') {
      return {
        status: 'already_enabled',
        server: {
          name: serverDef.name,
          displayName: serverDef.displayName,
          description: serverDef.description
        },
        message: `Server "${input.server_name}" is already enabled in your configuration.`,
        configUpdated: false
      };
    }

    // 3. Build server config from input + registry defaults
    const serverConfig: McpConfigServerEntry = {
      name: input.server_name,
      status: 'enabled',
      description: input.description || serverDef.description,
      command: serverDef.command,
      args: input.args || serverDef.defaultArgs,
      env: input.env,
      autoStart: input.auto_start !== undefined ? input.auto_start : true,
      timeout: input.timeout || 30000
    };

    // 4. Update or create config
    try {
      // Read current project config (or create new)
      let config = projectConfig || { servers: [] };

      // Add or update server
      const serverIndex = config.servers.findIndex(s => s.name === input.server_name);
      if (serverIndex >= 0) {
        config.servers[serverIndex] = serverConfig;
      } else {
        config.servers.push(serverConfig);
      }

      // Write config
      const configPath = `${projectPath}/MCP_CONFIG.md`;
      await configManager.writeConfig('project', config);

      return {
        status: 'success',
        server: {
          name: serverDef.name,
          displayName: serverDef.displayName,
          description: serverDef.description
        },
        message: `Successfully enabled "${serverDef.displayName}" server. Configuration written to ${configPath}. Server will auto-connect on next session or you can reconnect now.`,
        configUpdated: true,
        configPath,
        requiredEnv: serverDef.requiredEnv
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Failed to enable server: ${error instanceof Error ? error.message : String(error)}`,
        configUpdated: false
      };
    }
  }

  /**
   * Convert to canonical tool format for registration
   */
  static toCanonicalTool(): CanonicalTool {
    return {
      name: 'EnableMcpServer',
      description: 'Enable an MCP server by adding it to MCP_CONFIG.md. This makes the server\'s tools available for use. The server will auto-connect on next session creation.',
      schema: {
        type: 'object',
        properties: {
          server_name: {
            type: 'string',
            description: 'Name of server from registry (use ListAvailableMcpServers to see options). Examples: "postgres", "puppeteer", "filesystem"'
          },
          description: {
            type: 'string',
            description: 'Optional: Custom description for this server instance'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Custom command arguments (uses registry defaults if not provided)'
          },
          env: {
            type: 'object',
            description: 'Optional: Environment variables as key-value pairs (e.g., {"DATABASE_URL": "postgresql://..."})'
          },
          auto_start: {
            type: 'boolean',
            description: 'Auto-start server on session creation (default: true)'
          },
          timeout: {
            type: 'number',
            description: 'Connection timeout in milliseconds (default: 30000)'
          }
        },
        required: ['server_name']
      }
    };
  }
}
