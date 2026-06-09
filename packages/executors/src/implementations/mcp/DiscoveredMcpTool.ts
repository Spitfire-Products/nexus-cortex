/**
 * DiscoveredMcpTool - Dynamic MCP Tool Wrapper
 *
 * Each tool discovered from an MCP server is wrapped in this class
 * and registered as an individual tool in the tool registry.
 *
 * The LLM sees each MCP tool as a separate tool with its own name,
 * description, and parameter schema.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { McpClientManager } from '@nexus-cortex/core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Parameters for discovered MCP tools
 * The actual parameters are dynamic based on the tool's schema
 */
export type DiscoveredMcpToolParams = Record<string, unknown>;

/**
 * DiscoveredMcpTool - Wraps an individual MCP tool
 *
 * Each instance represents one tool from one MCP server.
 * These tools are dynamically registered after MCP server connection.
 *
 * Example:
 * - filesystem server exposes "read_file" → DiscoveredMcpTool("read_file", "filesystem", ...)
 * - github server exposes "create_issue" → DiscoveredMcpTool("create_issue", "github", ...)
 */
export class DiscoveredMcpToolExecutor extends BaseTool<
  DiscoveredMcpToolParams,
  ToolResult
> {
  private mcpManager: McpClientManager | undefined;

  constructor(
    private serverName: string,
    private serverToolName: string,
    private toolDeclaration: Tool,
    private mcpManagerGetter: () => McpClientManager | undefined,
    toolNameOverride?: string,
  ) {
    // Generate a valid tool name for the LLM
    const toolName = toolNameOverride ?? generateValidToolName(serverToolName);

    // Use the tool's description from MCP server
    const description = toolDeclaration.description || `Tool from MCP server '${serverName}'`;

    // Use the tool's parameter schema from MCP server
    const parameterSchema = (toolDeclaration.inputSchema || {
      type: 'object',
      properties: {},
    }) as any; // MCP schemas are dynamic

    super(
      toolName,
      toolName, // displayName
      `${description}\n\n*Source: ${serverName} MCP Server*`,
      parameterSchema,
    );

    this.mcpManager = mcpManagerGetter();
  }

  validateToolParams(params: DiscoveredMcpToolParams): string | null {
    // Validate against the MCP tool's schema
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    return null;
  }

  getDescription(params: DiscoveredMcpToolParams): string {
    return `Calling ${this.serverToolName} on ${this.serverName} MCP server`;
  }

  async execute(
    params: DiscoveredMcpToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Tool call was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
            serverName: this.serverName,
            toolName: this.serverToolName,
          },
        };
      }

      // Validate parameters
      const validationError = this.validateToolParams(params);
      if (validationError) {
        return {
          ...this.createErrorResult(validationError),
          metadata: {
            executionTime: Date.now() - startTime,
            serverName: this.serverName,
            toolName: this.serverToolName,
          },
        };
      }

      // Get MCP manager
      if (!this.mcpManager) {
        this.mcpManager = this.mcpManagerGetter();
      }

      if (!this.mcpManager) {
        return {
          ...this.createErrorResult(
            'MCP manager not available. MCP functionality requires proper configuration.',
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            serverName: this.serverName,
            toolName: this.serverToolName,
          },
        };
      }

      // Check server is connected
      if (!this.mcpManager.isServerConnected(this.serverName)) {
        return {
          ...this.createErrorResult(
            `MCP server '${this.serverName}' is not connected.`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            serverName: this.serverName,
            toolName: this.serverToolName,
          },
        };
      }

      // Execute the tool call with abort support
      const result = await this.executeWithAbort(
        this.mcpManager,
        this.serverName,
        this.serverToolName,
        params,
        signal,
      );

      // Check for abort after execution
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Tool call was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
            serverName: this.serverName,
            toolName: this.serverToolName,
          },
        };
      }

      // Format the result
      const formattedOutput = this.formatToolResult(result);

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          serverName: this.serverName,
          toolName: this.serverToolName,
          resultType: typeof result,
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Tool call was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
            serverName: this.serverName,
            toolName: this.serverToolName,
          },
        };
      }

      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(
          `Error calling MCP tool '${this.serverToolName}' on server '${this.serverName}': ${errorMessage}`,
        ),
        metadata: {
          executionTime: Date.now() - startTime,
          serverName: this.serverName,
          toolName: this.serverToolName,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Execute tool call with abort signal support
   */
  private async executeWithAbort(
    mcpManager: McpClientManager,
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        const error = new Error('Tool call aborted');
        error.name = 'AbortError';
        reject(error);
        return;
      }

      const onAbort = () => {
        cleanup();
        const error = new Error('Tool call aborted');
        error.name = 'AbortError';
        reject(error);
      };

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      mcpManager
        .callTool(serverName, toolName, args)
        .then((res) => {
          cleanup();
          resolve(res);
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    });
  }

  /**
   * Format MCP tool result for display
   */
  private formatToolResult(result: any): string {
    if (result === null || result === undefined) {
      return 'Tool executed successfully (no return value)';
    }

    // Handle MCP content blocks
    if (Array.isArray(result.content)) {
      return this.formatMcpContent(result.content);
    }

    // Handle direct result
    if (typeof result === 'string') {
      return result;
    }

    // Handle object result
    if (typeof result === 'object') {
      // Check if it's a simple text response
      if (result.text) {
        return result.text;
      }

      // Format as JSON
      return '```json\n' + JSON.stringify(result, null, 2) + '\n```';
    }

    return String(result);
  }

  /**
   * Format MCP content blocks (text, images, resources, etc.)
   */
  private formatMcpContent(content: any[]): string {
    const parts: string[] = [];

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue;
      }

      switch (block.type) {
        case 'text':
          if (block.text) {
            parts.push(block.text);
          }
          break;

        case 'image':
        case 'audio':
          parts.push(`[${block.type}: ${block.mimeType || 'unknown type'}]`);
          break;

        case 'resource':
          if (block.resource?.text) {
            parts.push(block.resource.text);
          } else {
            parts.push(`[Embedded Resource: ${block.resource?.mimeType || 'unknown type'}]`);
          }
          break;

        case 'resource_link':
          const title = block.title || block.name || 'Resource';
          parts.push(`[Link to ${title}: ${block.uri}]`);
          break;

        default:
          parts.push(`[Unknown content type: ${block.type}]`);
      }
    }

    return parts.length > 0 ? parts.join('\n') : 'Tool executed successfully';
  }
}

/**
 * Generate a valid tool name from MCP tool name
 * Follows Gemini API constraints:
 * - Max 63 characters
 * - Only alphanumeric, underscore, dash, dot
 */
export function generateValidToolName(name: string): string {
  // Replace invalid characters with underscores
  let validName = name.replace(/[^a-zA-Z0-9_.-]/g, '_');

  // If longer than 63 characters, truncate middle with '___'
  if (validName.length > 63) {
    validName = validName.slice(0, 28) + '___' + validName.slice(-32);
  }

  return validName;
}
