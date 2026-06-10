/**
 * Tools Info Command
 * Get detailed information about a specific tool
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ToolsInfoOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Get detailed tool information
 */
export async function toolsInfo(
  toolName: string,
  options: ToolsInfoOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const theme = ThemeManager.getTheme();

  // Validation
  if (!toolName) {
    console.error(theme.colors.error('Error: Tool name is required'));
    console.log(theme.colors.muted('\nUsage: cortex tools info <name>'));
    process.exit(1);
    return;
  }

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

    // Get tool details
    const response = await client.getToolInfo(toolName);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n Tool: ${response.name}\n`));

    console.log(theme.colors.secondary('Description:'));
    console.log(` ${theme.colors.muted(response.description)}`);
    console.log();

    if (response.category) {
      console.log(theme.colors.secondary('Category:'));
      console.log(` ${theme.colors.highlight(response.category)}`);
      console.log();
    }

    if (response.inputSchema) {
      console.log(theme.colors.secondary('Input Schema:'));
      console.log(` Type: ${theme.colors.muted(response.inputSchema.type)}`);

      if (response.inputSchema.properties) {
        console.log(` Properties:`);
        for (const [prop, schema] of Object.entries(response.inputSchema.properties)) {
          const propSchema = schema as any;
          const required = response.inputSchema.required?.includes(prop) ? theme.colors.warning(' (required)') : '';
          console.log(` ${theme.colors.highlight(prop)}${required}`);
          if (propSchema.description) {
            console.log(` ${theme.colors.muted(propSchema.description)}`);
          }
          if (propSchema.type) {
            console.log(` Type: ${theme.colors.muted(propSchema.type)}`);
          }
        }
      }
      console.log();
    }

  } catch (error: any) {
    if (error.message.includes('404') || error.message.includes('not found')) {
      console.error(theme.colors.error(`Error: Tool '${toolName}' not found`));
      console.log(theme.colors.muted('\nUse: cortex tools list to see available tools'));
    } else {
      console.error(theme.colors.error(`Error: ${error.message}`));
    }
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
