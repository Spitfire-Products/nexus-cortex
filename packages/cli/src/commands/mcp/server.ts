/**
 * Show specific MCP server details
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpServerOptions {
  serverUrl?: string;
  json?: boolean;
}

export async function mcpServer(name: string, options: McpServerOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  try {
    const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
    const client = new CortexClient(serverUrl);
    const server = await client.get(`/mcp/servers/${name}`);

    if (options.json) {
      console.log(JSON.stringify(server, null, 2));
      return;
    }

    console.log(theme.colors.secondary(`\n MCP Server: ${server.name}\n`));

    const statusIcon = server.status === 'connected' ? theme.colors.success('✓ Connected') : theme.colors.error('✗ Disconnected');
    console.log(theme.colors.muted(`Status: ${statusIcon}`));
    console.log(theme.colors.muted(`Tools: ${server.toolCount || 0}`));

    if (server.description) {
      console.log(theme.colors.muted(`Description: ${server.description}`));
    }

    if (server.config) {
      console.log(theme.colors.secondary('\nConfiguration:'));
      console.log(theme.colors.muted(JSON.stringify(server.config, null, 2)));
    }

    if (server.lastError) {
      console.log(theme.colors.error(`\nLast Error: ${server.lastError}`));
    }

    if (server.capabilities) {
      console.log(theme.colors.secondary('\nCapabilities:'));
      for (const [key, value] of Object.entries(server.capabilities)) {
        console.log(theme.colors.muted(` ${key}: ${JSON.stringify(value)}`));
      }
    }

    console.log();
  } catch (error: any) {
    console.error(theme.colors.error(`✗ Error getting server details:`), error.message);
    process.exit(1);
  }
}
