/**
 * Disable an MCP server
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpDisableOptions {
  serverUrl?: string;
}

export async function mcpDisable(name: string, options: McpDisableOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  try {
    const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
    const client = new CortexClient(serverUrl);

    console.log(theme.colors.secondary(`\n Disabling MCP server: ${name}...\n`));

    const response = await client.post(`/mcp/servers/${name}/disconnect`, {});

    if (response.success) {
      console.log(theme.colors.success(`✓ ${response.message}\n`));
    } else {
      console.log(theme.colors.error('✗ Disable failed\n'));
    }
  } catch (error: any) {
    console.error(theme.colors.error('✗ Error disabling MCP server:'), error.message);
    process.exit(1);
  }
}
