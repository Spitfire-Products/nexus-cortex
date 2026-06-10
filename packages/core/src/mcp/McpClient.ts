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
import { logger } from '../utils/logger.js';

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
  /** Transient stream drop; the SDK is auto-reconnecting, client still usable. */
  RECONNECTING = 'reconnecting',
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

        // Disable undici's response body-inactivity timeout for the long-lived
        // SSE stream. Without this, an idle server->client stream (no messages
        // between tool calls) is terminated after undici's default (~300s),
        // surfacing as "SSE stream disconnected: TypeError: terminated" and a
        // needless reconnect every few minutes. The SDK's reconnection still
        // covers genuine drops; this just stops the idle-timeout churn.
        const dispatcher = await this.createNoIdleTimeoutDispatcher();

        const requestInit: Record<string, unknown> = {
          ...(this.config.headers ? { headers: this.config.headers } : {}),
          ...(dispatcher ? { dispatcher } : {}),
        };

        this.transport = new StreamableHTTPClientTransport(
          new URL(this.config.url),
          {
            ...(Object.keys(requestInit).length > 0
              ? { requestInit: requestInit as RequestInit }
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

      // Setup error handler. HTTP/SSE transports drop the long-lived stream
      // periodically (idle timeouts, key rotation, network blips); the SDK
      // auto-reconnects per reconnectionOptions. Treat those as recoverable —
      // a gated debug note, NOT a console.error stack that corrupts the TUI,
      // and NOT a permanent ERROR state (which would make isConnected() throw
      // mid-reconnect). Only a terminal "max retries exceeded" or a genuine
      // protocol error flips the client to ERROR.
      this.client.onerror = (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        // Errors fired while we are intentionally tearing the connection down
        // (the SSE stream aborts on close) are expected noise — ignore them.
        if (
          this.status === McpConnectionStatus.DISCONNECTING ||
          this.status === McpConnectionStatus.DISCONNECTED
        ) {
          logger.debug(`[MCP ${this.config.name}] error during teardown (ignored): ${msg}`);
          return;
        }
        if (this.isRecoverableStreamError(msg)) {
          this.status = McpConnectionStatus.RECONNECTING;
          logger.debug(`[MCP ${this.config.name}] stream drop; auto-reconnecting: ${msg}`);
        } else {
          this.status = McpConnectionStatus.ERROR;
          logger.warn(`[MCP ${this.config.name}] ${msg}`);
        }
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
      // A successful call means the stream recovered — self-heal the status.
      if (this.status === McpConnectionStatus.RECONNECTING) {
        this.status = McpConnectionStatus.CONNECTED;
      }
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
    // RECONNECTING is a transient SSE drop the SDK is recovering from — the
    // client is still usable (tool POSTs succeed and trigger reconnect), so
    // it counts as connected. Only DISCONNECTED/ERROR/CONNECTING do not.
    return (
      this.status === McpConnectionStatus.CONNECTED ||
      this.status === McpConnectionStatus.RECONNECTING
    );
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
   * Recoverable transport errors: transient SSE/network drops that the SDK's
   * reconnection loop handles on its own. A terminal "Maximum reconnection
   * attempts exceeded" is NOT recoverable and must surface as ERROR.
   */
  private isRecoverableStreamError(msg: string): boolean {
    if (/maximum reconnection attempts/i.test(msg)) return false;
    return /sse stream disconnected|failed to reconnect sse|terminated|socket hang ?up|econnreset|etimedout|epipe|other side closed|fetch failed|network|operation was aborted|aborted/i.test(
      msg,
    );
  }

  /**
   * Build an undici dispatcher with the response body-inactivity timeout
   * disabled (bodyTimeout: 0), so a long-lived idle SSE stream is not
   * terminated mid-session. Returns undefined when undici is unavailable
   * (e.g. a non-Node runtime) — the transport then uses the default fetch and
   * relies on the SDK's reconnection.
   */
  private async createNoIdleTimeoutDispatcher(): Promise<unknown | undefined> {
    try {
      const undici = await import('undici');
      return new undici.Agent({ bodyTimeout: 0 });
    } catch (err) {
      logger.debug(
        `[MCP ${this.config.name}] undici unavailable; SSE keep-alive dispatcher skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
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
