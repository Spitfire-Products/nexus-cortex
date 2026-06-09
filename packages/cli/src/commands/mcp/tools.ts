/**
 * List tools from a specific MCP server
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpToolsOptions {
  serverUrl?: string;
  json?: boolean;
  all?: boolean;  // Show all MCP tools across all servers
}

export async function mcpTools(serverName: string | undefined, options: McpToolsOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  try {
    const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
    const client = new CortexClient(serverUrl);

    let response;
    if (options.all || !serverName) {
      // Get all MCP tools across all servers
      response = await client.get('/mcp/tools');

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      if (!response.enabled) {
        console.log(theme.colors.warning('\n⚠  MCP is not enabled\n'));
        return;
      }

      const tools = response.tools || [];

      if (tools.length === 0) {
        console.log(theme.colors.secondary('\n MCP Tools\n'));
        console.log(theme.colors.muted('No MCP tools available\n'));
        return;
      }

      console.log(theme.colors.secondary(`\n MCP Tools (${tools.length} total)\n`));

      // Group tools by server
      const byServer = new Map<string, any[]>();
      for (const tool of tools) {
        const serverName = tool.serverName || 'unknown';
        if (!byServer.has(serverName)) {
          byServer.set(serverName, []);
        }
        byServer.get(serverName)!.push(tool);
      }

      for (const [server, serverTools] of byServer.entries()) {
        console.log(theme.colors.highlight(`${server} (${serverTools.length} tools):`));
        for (const tool of serverTools) {
          console.log(theme.colors.muted(` • ${tool.name}`));
          if (tool.description) {
            console.log(theme.colors.muted(` ${tool.description}`));
          }
        }
        console.log();
      }
    } else {
      // Get tools from specific server
      response = await client.get(`/mcp/servers/${serverName}/tools`);

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      const tools = response.tools || [];

      if (tools.length === 0) {
        console.log(theme.colors.secondary(`\n Tools from ${serverName}\n`));
        console.log(theme.colors.muted('No tools available\n'));
        return;
      }

      console.log(theme.colors.secondary(`\n Tools from ${serverName} (${tools.length} total)\n`));

      for (const tool of tools) {
        console.log(theme.colors.highlight(`${tool.name}`));
        if (tool.description) {
          console.log(theme.colors.muted(` ${tool.description}`));
        }
        if (tool.inputSchema) {
          console.log(theme.colors.muted(` Parameters: ${Object.keys(tool.inputSchema.properties || {}).join(', ')}`));
        }
        console.log();
      }
    }
  } catch (error: any) {
    console.error(theme.colors.error('✗ Error listing MCP tools:'), error.message);
    process.exit(1);
  }
}
