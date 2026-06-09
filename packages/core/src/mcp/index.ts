/**
 * MCP (Model Context Protocol) Infrastructure
 *
 * Minimal viable MCP implementation for Nexus Cortex.
 * Provides client management and server communication via stdio transport.
 */

export { McpClient, McpConnectionStatus } from './McpClient.js';
export type { McpServerConfig } from './McpClient.js';

export { McpClientManager, McpDiscoveryState } from './McpClientManager.js';
export type { McpServerInfo } from './McpClientManager.js';
