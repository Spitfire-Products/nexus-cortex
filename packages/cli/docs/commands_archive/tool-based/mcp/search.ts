/**
 * Search MCP servers by keyword
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpSearchOptions {
  serverUrl?: string;
  capability?: string;
  json?: boolean;
}

/**
 * Search MCP servers by query string
 */
export async function mcpSearch(
  query: string,
  options: McpSearchOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    // Get all MCP servers
    const response = await client.get('/mcp/servers');
    let servers = response.servers || [];

    // Filter by query (search in name, description, tags)
    const lowerQuery = query.toLowerCase();
    servers = servers.filter((server: any) => {
      const matchName = server.name?.toLowerCase().includes(lowerQuery);
      const matchDescription = server.description?.toLowerCase().includes(lowerQuery);
      const matchTags = server.tags?.some((tag: string) =>
        tag.toLowerCase().includes(lowerQuery)
      );
      return matchName || matchDescription || matchTags;
    });

    // Filter by capability if specified
    if (options.capability) {
      servers = servers.filter((server: any) =>
        server.capabilities?.includes(options.capability)
      );
    }

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({ servers, count: servers.length }, null, 2));
      return;
    }

    // Display results
    console.log(theme.colors.primary(`\nMCP Server Search: "${query}"`));
    if (options.capability) {
      console.log(theme.colors.muted(`Capability filter: ${options.capability}`));
    }
    console.log();

    if (servers.length === 0) {
      console.log(theme.colors.warning('No servers found matching query'));
      console.log(theme.colors.muted('Try a different search term or check available servers:'));
      console.log(theme.colors.muted('  cortex mcp list'));
      console.log();
      return;
    }

    console.log(theme.colors.secondary(`Found ${servers.length} server(s):`));
    console.log();

    servers.forEach((server: any) => {
      console.log(theme.colors.highlight(`  ${server.name}`));

      if (server.description) {
        console.log(theme.colors.muted(`    ${server.description}`));
      }

      if (server.status) {
        const statusColor = server.status === 'connected'
          ? theme.colors.success
          : theme.colors.muted;
        console.log(statusColor(`    Status: ${server.status}`));
      }

      if (server.capabilities && server.capabilities.length > 0) {
        console.log(theme.colors.muted(`    Capabilities: ${server.capabilities.join(', ')}`));
      }

      if (server.tags && server.tags.length > 0) {
        console.log(theme.colors.muted(`    Tags: ${server.tags.join(', ')}`));
      }

      console.log();
    });

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
