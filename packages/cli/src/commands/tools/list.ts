/**
 * Tools List Command
 * List all available tools
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ToolsListOptions {
  serverUrl?: string;
  json?: boolean;
  grouped?: boolean;
}

/**
 * List all available tools
 */
export async function toolsList(
  options: ToolsListOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const theme = ThemeManager.getTheme();

  // Determine mode from environment
  const envMode = (process.env.CORTEX_MODE);
  const mode = envMode === 'server' ? 'server' : 'direct';

  const client = new OrchestratorClient({
    mode,
    serverUrl: options.serverUrl || config.serverUrl || 'http://localhost:4000',
    debug: process.env.DEBUG === 'true'
  });

  try {
    await client.initialize();

    // Get tools
    const response = await client.listTools(options.grouped);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n Available Tools (${response.totalCount})\n`));

    if (options.grouped && response.grouped) {
      // Grouped by category
      for (const [category, tools] of Object.entries(response.grouped)) {
        console.log(theme.colors.secondary(`${category.toUpperCase()} (${(tools as any[]).length}):`));
        for (const tool of tools as any[]) {
          console.log(` ${theme.colors.highlight(tool.name)}`);
          console.log(` ${theme.colors.muted(tool.description)}`);
        }
        console.log();
      }
    } else {
      // Simple list
      for (const tool of response.tools) {
        console.log(theme.colors.highlight(`${tool.name}:`));
        console.log(` ${theme.colors.muted(tool.description)}`);
        if (tool.category) {
          console.log(` Category: ${theme.colors.muted(tool.category)}`);
        }
        console.log();
      }
    }

    console.log(theme.colors.muted('Use: cortex tools info <name> for detailed information'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
