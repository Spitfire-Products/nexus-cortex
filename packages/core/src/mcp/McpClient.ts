/**
 * Minimal MCP Client for Nexus Cortex
 *
 * Supports stdio and StreamableHTTP transports. No OAuth/auth complexity;
 * HTTP servers can supply auth via static headers or rely on server-side
 * auto-provisioning at connect time.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';

export type McpTransportType = 'stdio' | 'http';

export interface McpReconnectionOptions {
  /** Max attempts before the SDK gives up on a dropped SSE channel */
  maxRetries: number;
  /** Initial backoff in ms */
  initialReconnectionDelay: number;
  /** Maximum backoff in ms */
  maxReconnectionDelay: number;
  /** Multiplier applied between attempts */
  reconnectionDelayGrowFactor: number;
}

/**
 * Defaults for HTTP-MCP reconnection. The SDK's own defaults (maxRetries: 2)
 * are far too low for long-running cortex sessions where the SSE channel may
 * drop during a multi-minute tool sequence. We default to 10 retries with
 * exponential backoff capped at 30 seconds.
 */
const DEFAULT_HTTP_RECONNECTION_OPTIONS: McpReconnectionOptions = {
  maxRetries: 10,
  initialReconnectionDelay: 1_000,
  maxReconnectionDelay: 30_000,
  reconnectionDelayGrowFactor: 1.5,
};

export interface McpServerConfig {
  /** Server name/identifier */
  name: string;

  /**
   * Transport type. Defaults to 'http' when `url` is set, otherwise 'stdio'.
   */
  transport?: McpTransportType;

  /** Command to execute (stdio transport) */
  command?: string;

  /** Command arguments (stdio transport) */
  args?: string[];

  /** Environment variables (stdio transport) */
  env?: Record<string, string>;

  /** Working directory (stdio transport) */
  cwd?: string;

  /** Server URL (http transport) */
  url?: string;

  /** Optional static HTTP headers (http transport) */
  headers?: Record<string, string>;

  /** Override reconnection backoff for the HTTP SSE channel */
  reconnectionOptions?: McpReconnectionOptions;

  /** Connection timeout in milliseconds */
  timeout?: number;
}

export enum McpConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTING = 'disconnecting',
  ERROR = 'error',
}

/**
 * Minimal MCP Client for connecting to and interacting with MCP servers
 */
export class McpClient {
  private client: Client | undefined;
  private transport: Transport | undefined;
  private status: McpConnectionStatus = McpConnectionStatus.DISCONNECTED;
  private discoveredTools: Tool[] = [];
  private discoveredResources: Resource[] = [];
  private discoveredPrompts: Prompt[] = [];

  constructor(
    private readonly config: McpServerConfig,
    private readonly debugMode: boolean = false,
  ) {}

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.status !== McpConnectionStatus.DISCONNECTED) {
      throw new Error(
        `Cannot connect when status is ${this.status}. Current status must be DISCONNECTED.`,
      );
    }

    this.status = McpConnectionStatus.CONNECTING;

    try {
      // Create MCP client
      this.client = new Client({
        name: 'nexus-cortex-mcp-client',
        version: '1.0.0',
      });

      // Resolve transport type — default to 'http' when url is set, else 'stdio'
      const transportType: McpTransportType =
        this.config.transport ?? (this.config.url ? 'http' : 'stdio');

      if (transportType === 'http') {
        if (!this.config.url) {
          throw new Error('http transport requires a url to be specified');
        }

        this.transport = new StreamableHTTPClientTransport(
          new URL(this.config.url),
          {
            ...(this.config.headers
              ? { requestInit: { headers: this.config.headers } }
              : {}),
            reconnectionOptions: this.getResolvedReconnectionOptions(),
          },
        );
      } else {
        if (!this.config.command) {
          throw new Error('stdio transport requires a command to be specified');
        }

        this.transport = new StdioClientTransport({
          command: this.config.command,
          args: this.config.args || [],
          env: {
            ...process.env,
            ...(this.config.env || {}),
          } as Record<string, string>,
          cwd: this.config.cwd,
          stderr: 'pipe',
        });

        // Log stderr if debug mode (stdio only)
        if (this.debugMode && 'stderr' in this.transport) {
          const stderr = (this.transport as any).stderr;
          if (stderr) {
            stderr.on('data', (data: Buffer) => {
              console.error(`[MCP STDERR (${this.config.name})]:`, data.toString().trim());
            });
          }
        }
      }

      // Setup error handler
      this.client.onerror = (error) => {
        console.error(`MCP Error (${this.config.name}):`, error);
        this.status = McpConnectionStatus.ERROR;
      };

      // Setup close handler
      this.client.onclose = () => {
        this.status = McpConnectionStatus.DISCONNECTED;
      };

      // Connect to server
      await this.client.connect(this.transport, {
        timeout: this.config.timeout ?? 10000, // 10 second default
      });

      this.status = McpConnectionStatus.CONNECTED;
    } catch (error) {
      this.status = McpConnectionStatus.ERROR;
      throw new Error(
        `Failed to connect to MCP server '${this.config.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.status === McpConnectionStatus.DISCONNECTED) {
      return;
    }

    this.status = McpConnectionStatus.DISCONNECTING;

    try {
      if (this.client) {
        await this.client.close();
      }
      if (this.transport) {
        await this.transport.close();
      }
    } finally {
      this.status = McpConnectionStatus.DISCONNECTED;
      this.client = undefined;
      this.transport = undefined;
    }
  }

  /**
   * Discover tools from the MCP server
   */
  async discoverTools(): Promise<Tool[]> {
    this.assertConnected();

    try {
      const response = await this.client!.listTools();
      this.discoveredTools = response.tools || [];
      return this.discoveredTools;
    } catch (error) {
      throw new Error(
        `Failed to discover tools from MCP server '${this.config.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Discover resources from the MCP server
   * Returns empty array if server doesn't support resources (Method not found -32601)
   */
  async discoverResources(): Promise<Resource[]> {
    this.assertConnected();

    try {
      const response = await this.client!.listResources();
      this.discoveredResources = response.resources || [];
      return this.discoveredResources;
    } catch (error: any) {
      // MCP error -32601 means "Method not found" - server doesn't implement this capability
      // This is expected for servers that only provide tools (like filesystem server)
      if (error?.code === -32601 || error?.message?.includes('-32601') || error?.message?.includes('Method not found')) {
        this.discoveredResources = [];
        return this.discoveredResources;
      }
      throw new Error(
        `Failed to discover resources from MCP server '${this.config.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Discover prompts from the MCP server
   * Returns empty array if server doesn't support prompts (Method not found -32601)
   */
  async discoverPrompts(): Promise<Prompt[]> {
    this.assertConnected();

    try {
      const response = await this.client!.listPrompts();
      this.discoveredPrompts = response.prompts || [];
      return this.discoveredPrompts;
    } catch (error: any) {
      // MCP error -32601 means "Method not found" - server doesn't implement this capability
      // This is expected for servers that only provide tools (like filesystem server)
      if (error?.code === -32601 || error?.message?.includes('-32601') || error?.message?.includes('Method not found')) {
        this.discoveredPrompts = [];
        return this.discoveredPrompts;
      }
      throw new Error(
        `Failed to discover prompts from MCP server '${this.config.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<any> {
    this.assertConnected();

    try {
      const result = await this.client!.callTool({
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (error) {
      throw new Error(
        `Failed to call tool '${toolName}' on MCP server '${this.config.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Read a resource from the MCP server
   */
  async readResource(uri: string): Promise<any> {
    this.assertConnected();

    try {
      const result = await this.client!.readResource({
        uri,
      });
      return result;
    } catch (error) {
      throw new Error(
        `Failed to read resource '${uri}' from MCP server '${this.config.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get discovered tools
   */
  getDiscoveredTools(): Tool[] {
    return [...this.discoveredTools];
  }

  /**
   * Get discovered resources
   */
  getDiscoveredResources(): Resource[] {
    return [...this.discoveredResources];
  }

  /**
   * Get discovered prompts
   */
  getDiscoveredPrompts(): Prompt[] {
    return [...this.discoveredPrompts];
  }

  /**
   * Get connection status
   */
  getStatus(): McpConnectionStatus {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === McpConnectionStatus.CONNECTED;
  }

  /**
   * Return the reconnection options that will be (or were) supplied to the
   * HTTP transport. Returns undefined for stdio transport. Useful for tests
   * and operational introspection.
   */
  getReconnectionOptions(): McpReconnectionOptions | undefined {
    const transportType: McpTransportType =
      this.config.transport ?? (this.config.url ? 'http' : 'stdio');
    if (transportType !== 'http') return undefined;
    return this.getResolvedReconnectionOptions();
  }

  private getResolvedReconnectionOptions(): McpReconnectionOptions {
    return this.config.reconnectionOptions ?? DEFAULT_HTTP_RECONNECTION_OPTIONS;
  }

  /**
   * Assert that the client is connected
   */
  private assertConnected(): void {
    if (!this.isConnected() || !this.client) {
      throw new Error(
        `MCP client for '${this.config.name}' is not connected. Current status: ${this.status}`,
      );
    }
  }
}
