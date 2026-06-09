/**
 * Show overall MCP status
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

export async function mcpStatus(options: McpStatusOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  try {
    const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
    const client = new CortexClient(serverUrl);
    const response = await client.get('/mcp/status');

    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    console.log(theme.colors.secondary('\n MCP Status\n'));

    if (!response.enabled) {
      console.log(theme.colors.warning('Status: Disabled\n'));
      return;
    }

    console.log(theme.colors.success('Status: Enabled'));
    console.log(theme.colors.muted(`Servers: ${response.serverCount || 0}`));
    console.log(theme.colors.muted(`Connected: ${response.connectedCount || 0}`));
    console.log(theme.colors.muted(`Total Tools: ${response.toolCount || 0}`));

    if (response.servers && response.servers.length > 0) {
      console.log(theme.colors.secondary('\nServers:'));
      for (const server of response.servers) {
        const statusIcon = server.status === 'connected' ? theme.colors.success('✓') : theme.colors.error('✗');
        console.log(` ${statusIcon} ${server.name} (${server.toolCount || 0} tools)`);
        if (server.lastError) {
          console.log(theme.colors.error(` Error: ${server.lastError}`));
        }
      }
    }

    console.log();
  } catch (error: any) {
    console.error(theme.colors.error('✗ Error getting MCP status:'), error.message);
    process.exit(1);
  }
}
