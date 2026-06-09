/**
 * Permissions Grant Command
 * Grant permission for a tool
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsGrantOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Grant permission for a tool
 */
export async function permissionsGrant(
  toolName: string,
  options: PermissionsGrantOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const theme = ThemeManager.getTheme();

  // Create client (will use direct mode by default)
  const client = new OrchestratorClient({
    serverUrl: options.serverUrl || config.serverUrl,
    projectPath: process.env.PROJECT_PATH || process.cwd()
  });

  try {
    // Validation
    if (!toolName) {
      console.error(theme.colors.error('Error: Tool name is required'));
      console.log(theme.colors.muted('\nUsage: cortex permissions grant <tool>'));
      process.exit(1);
      return;
    }

    // Grant permission
    await client.grantToolPermission(toolName);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({ success: true, toolName }, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success(`\n✓ Permission granted for tool: ${toolName}\n`));

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
