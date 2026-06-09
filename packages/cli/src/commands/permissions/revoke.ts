/**
 * Permissions Revoke Command
 * Revoke permission for a tool
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsRevokeOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Revoke permission for a tool
 */
export async function permissionsRevoke(
  toolName: string,
  options: PermissionsRevokeOptions = {}
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
      console.log(theme.colors.muted('\nUsage: cortex permissions revoke <tool>'));
      process.exit(1);
      return;
    }

    // Revoke permission
    await client.revokeToolPermission(toolName);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({ success: true, toolName }, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.warning(`\n⚠  Permission revoked for tool: ${toolName}\n`));

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
