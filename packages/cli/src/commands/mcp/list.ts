/**
 * List all MCP servers
 */
import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ListMcpServersOptions {
  serverUrl?: string;
  json?: boolean;
}

export async function listMcpServers(options: ListMcpServersOptions): Promise<void> {
  const theme = ThemeManager.getTheme();

  // Determine mode from environment
  const envMode = (process.env.CORTEX_MODE);
  const mode = envMode === 'server' ? 'server' : 'direct';

  const client = new OrchestratorClient({
    mode,
    serverUrl: options.serverUrl || ConfigManager.get('serverUrl'),
    debug: process.env.DEBUG === 'true'
  });

  try {
    await client.initialize();
    const response = await client.listMcpServers();

    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    if (!response.enabled) {
      console.log(theme.colors.warning('\n⚠  MCP is not enabled\n'));
      return;
    }

    const servers = response.servers || [];

    if (servers.length === 0) {
      console.log(theme.colors.secondary('\n MCP Servers\n'));
      console.log(theme.colors.muted('No MCP servers configured\n'));
      return;
    }

    console.log(theme.colors.secondary(`\n MCP Servers (${servers.length} total)\n`));

    for (const server of servers) {
      console.log(theme.colors.highlight(server.name));
      console.log(theme.colors.muted(` Status: ${server.status === 'connected' ? theme.colors.success('✓ Connected') : theme.colors.error('✗ Disconnected')}`));
      console.log(theme.colors.muted(` Tools: ${server.toolCount || 0}`));

      if (server.description) {
        console.log(theme.colors.muted(` Description: ${server.description}`));
      }

      if (server.lastError) {
        console.log(theme.colors.error(` Last Error: ${server.lastError}`));
      }

      console.log();
    }
  } catch (error: any) {
    console.error(theme.colors.error('✗ Error listing MCP servers:'), error.message);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
