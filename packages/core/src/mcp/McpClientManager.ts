/**
 * MCP Client Manager for Nexus Cortex
 *
 * Manages multiple MCP server connections and aggregates their tools/resources.
 * Provides centralized connection lifecycle management.
 */

import { McpClient, type McpServerConfig, McpConnectionStatus } from './McpClient.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';

/**
 * Discovery state for MCP tools
 */
export enum McpDiscoveryState {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ERROR = 'error',
}

/**
 * MCP server connection info
 */
export interface McpServerInfo {
  name: string;
  config: McpServerConfig;
  client: McpClient;
  status: McpConnectionStatus;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  lastError?: string;
}

/**
 * MCP Client Manager
 *
 * Manages multiple MCP server connections and provides:
 * - Centralized connection management
 * - Tool/resource/prompt aggregation across all servers
 * - Discovery state tracking
 * - Error handling and logging
 */
export class McpClientManager {
  private clients: Map<string, McpClient> = new Map();
  private configs: Map<string, McpServerConfig> = new Map();
  private discoveryState: McpDiscoveryState = McpDiscoveryState.NOT_STARTED;
  private discoveryPromise: Promise<void> | undefined;
  // R15 (race serialization): concurrent connectToServer(name) calls share
  // one in-flight connect instead of each tearing down the prior client.
  private connectInFlight: Map<string, Promise<void>> = new Map();

  constructor(private readonly debugMode: boolean = false) {}

  /**
   * Add an MCP server configuration
   */
  addServerConfig(name: string, config: McpServerConfig): void {
    // Ensure name matches config
    const serverConfig: McpServerConfig = {
      ...config,
      name,
    };
    this.configs.set(name, serverConfig);
  }

  /**
   * Remove an MCP server configuration
   */
  removeServerConfig(name: string): void {
    this.configs.delete(name);
  }

  /**
   * Get all configured server names
   */
  getServerNames(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Get server configuration
   */
  getServerConfig(name: string): McpServerConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * Connect to a specific MCP server
   */
  async connectToServer(name: string): Promise<void> {
    // R15: serialize concurrent connects to the same server — share the
    // in-flight promise so a racing second caller doesn't tear down the
    // first's client mid-connect. Sequential calls (after resolution) still
    // start a fresh connect because the entry is cleared on settle.
    const existing = this.connectInFlight.get(name);
    if (existing) return existing;

    const p = this._doConnectToServer(name).finally(() => {
      this.connectInFlight.delete(name);
    });
    this.connectInFlight.set(name, p);
    return p;
  }

  private async _doConnectToServer(name: string): Promise<void> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`No configuration found for MCP server '${name}'`);
    }

    // Disconnect existing client if present
    await this.disconnectFromServer(name);

    // Create and connect new client
    const client = new McpClient(config, this.debugMode);
    this.clients.set(name, client);

    try {
      await client.connect();
      if (this.debugMode) {
        console.log(`[MCP Manager] Connected to server '${name}'`);
      }
    } catch (error) {
      this.clients.delete(name);
      throw error;
    }
  }

  /**
   * Disconnect from a specific MCP server
   */
  async disconnectFromServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      try {
        await client.disconnect();
        if (this.debugMode) {
          console.log(`[MCP Manager] Disconnected from server '${name}'`);
        }
      } catch (error) {
        console.error(`[MCP Manager] Error disconnecting from server '${name}':`, error);
      } finally {
        this.clients.delete(name);
      }
    }
  }

  /**
   * Connect to all configured MCP servers
   */
  async connectToAllServers(): Promise<void> {
    const names = this.getServerNames();

    if (this.debugMode) {
      console.log(`[MCP Manager] Connecting to ${names.length} server(s)...`);
    }

    const results = await Promise.allSettled(
      names.map((name) => this.connectToServer(name))
    );

    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const name = names[index];
        console.error(`[MCP Manager] Failed to connect to '${name}':`, result.reason);
      }
    });
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnectFromAllServers(): Promise<void> {
    const names = Array.from(this.clients.keys());

    if (this.debugMode) {
      console.log(`[MCP Manager] Disconnecting from ${names.length} server(s)...`);
    }

    await Promise.all(
      names.map((name) => this.disconnectFromServer(name))
    );
  }

  /**
   * Discover tools from a specific MCP server
   */
  async discoverServerTools(name: string): Promise<Tool[]> {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`MCP server '${name}' is not connected`);
    }

    return await client.discoverTools();
  }

  /**
   * Discover resources from a specific MCP server
   */
  async discoverServerResources(name: string): Promise<Resource[]> {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`MCP server '${name}' is not connected`);
    }

    return await client.discoverResources();
  }

  /**
   * Discover prompts from a specific MCP server
   */
  async discoverServerPrompts(name: string): Promise<Prompt[]> {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`MCP server '${name}' is not connected`);
    }

    return await client.discoverPrompts();
  }

  /**
   * Discover all tools, resources, and prompts from all connected servers
   */
  async discoverAll(): Promise<void> {
    if (this.discoveryPromise) {
      // Discovery already in progress, wait for it
      return this.discoveryPromise;
    }

    this.discoveryState = McpDiscoveryState.IN_PROGRESS;

    this.discoveryPromise = (async () => {
      try {
        const serverNames = Array.from(this.clients.keys());

        if (this.debugMode) {
          console.log(`[MCP Manager] Discovering tools from ${serverNames.length} server(s)...`);
        }

        // Discover from all servers in parallel
        await Promise.all(
          serverNames.map(async (name) => {
            try {
              const client = this.clients.get(name);
              if (!client) return;

              await Promise.all([
                client.discoverTools(),
                client.discoverResources(),
                client.discoverPrompts(),
              ]);

              if (this.debugMode) {
                const tools = client.getDiscoveredTools();
                const resources = client.getDiscoveredResources();
                const prompts = client.getDiscoveredPrompts();
                console.log(
                  `[MCP Manager] Server '${name}': ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`
                );
              }
            } catch (error) {
              console.error(`[MCP Manager] Discovery failed for server '${name}':`, error);
            }
          })
        );

        this.discoveryState = McpDiscoveryState.COMPLETED;
      } catch (error) {
        this.discoveryState = McpDiscoveryState.ERROR;
        throw error;
      } finally {
        this.discoveryPromise = undefined;
      }
    })();

    return this.discoveryPromise;
  }

  /**
   * Get all tools from all connected servers
   */
  getAllTools(): Array<Tool & { serverName: string }> {
    const allTools: Array<Tool & { serverName: string }> = [];

    for (const [serverName, client] of this.clients.entries()) {
      const tools = client.getDiscoveredTools();
      tools.forEach((tool) => {
        allTools.push({
          ...tool,
          serverName,
        });
      });
    }

    return allTools;
  }

  /**
   * Get all resources from all connected servers
   */
  getAllResources(): Array<Resource & { serverName: string }> {
    const allResources: Array<Resource & { serverName: string }> = [];

    for (const [serverName, client] of this.clients.entries()) {
      const resources = client.getDiscoveredResources();
      resources.forEach((resource) => {
        allResources.push({
          ...resource,
          serverName,
        });
      });
    }

    return allResources;
  }

  /**
   * Get all prompts from all connected servers
   */
  getAllPrompts(): Array<Prompt & { serverName: string }> {
    const allPrompts: Array<Prompt & { serverName: string }> = [];

    for (const [serverName, client] of this.clients.entries()) {
      const prompts = client.getDiscoveredPrompts();
      prompts.forEach((prompt) => {
        allPrompts.push({
          ...prompt,
          serverName,
        });
      });
    }

    return allPrompts;
  }

  /**
   * Call a tool on a specific MCP server
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server '${serverName}' is not connected`);
    }

    return await client.callTool(toolName, args);
  }

  /**
   * Read a resource from a specific MCP server
   */
  async readResource(serverName: string, uri: string): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server '${serverName}' is not connected`);
    }

    return await client.readResource(uri);
  }

  /**
   * Get information about all connected servers
   */
  getServerInfo(): McpServerInfo[] {
    const info: McpServerInfo[] = [];

    for (const [name, config] of this.configs.entries()) {
      const client = this.clients.get(name);

      if (client) {
        info.push({
          name,
          config,
          client,
          status: client.getStatus(),
          toolCount: client.getDiscoveredTools().length,
          resourceCount: client.getDiscoveredResources().length,
          promptCount: client.getDiscoveredPrompts().length,
        });
      } else {
        info.push({
          name,
          config,
          client: null as any,
          status: McpConnectionStatus.DISCONNECTED,
          toolCount: 0,
          resourceCount: 0,
          promptCount: 0,
        });
      }
    }

    return info;
  }

  /**
   * Get the current discovery state
   */
  getDiscoveryState(): McpDiscoveryState {
    return this.discoveryState;
  }

  /**
   * Get a specific client by name
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  /**
   * Check if a server is connected
   */
  isServerConnected(name: string): boolean {
    const client = this.clients.get(name);
    return client?.isConnected() ?? false;
  }

  /**
   * Get count of connected servers
   */
  getConnectedServerCount(): number {
    return Array.from(this.clients.values()).filter((client) =>
      client.isConnected()
    ).length;
  }

  /**
   * Cleanup all connections (call on shutdown)
   */
  async cleanup(): Promise<void> {
    await this.disconnectFromAllServers();
    this.configs.clear();
    this.discoveryState = McpDiscoveryState.NOT_STARTED;
  }
}
