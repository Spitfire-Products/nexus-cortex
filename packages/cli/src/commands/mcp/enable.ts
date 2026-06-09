/**
 * Enable an MCP server
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpEnableOptions {
  serverUrl?: string;
}

export async function mcpEnable(name: string, options: McpEnableOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  try {
    const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
    const client = new CortexClient(serverUrl);

    console.log(theme.colors.secondary(`\n Enabling MCP server: ${name}...\n`));

    const response = await client.post(`/mcp/servers/${name}/connect`, {});

    if (response.success) {
      console.log(theme.colors.success(`✓ ${response.message}`));
      console.log(theme.colors.muted('\nUse `cortex mcp tools ' + name + '` to see available tools\n'));
    } else {
      console.log(theme.colors.error('✗ Enable failed\n'));
    }
  } catch (error: any) {
    console.error(theme.colors.error('✗ Error enabling MCP server:'), error.message);
    process.exit(1);
  }
}
