/**
 * Permissions Tools Command
 * List permission policies affecting tools
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsToolsOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List permission policies affecting tools
 */
export async function permissionsTools(
  options: PermissionsToolsOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const theme = ThemeManager.getTheme();

  // Create client (will use direct mode by default)
  const client = new OrchestratorClient({
    serverUrl: options.serverUrl || config.serverUrl,
    projectPath: process.env.PROJECT_PATH || process.cwd()
  });

  try {
    // Get policies (which control tool permissions)
    const policies = await client.getPolicies();

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({ policies }, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n Permission Policies (${policies.length})\n`));

    if (policies && policies.length > 0) {
      policies.forEach((policy: any) => {
        const status = policy.enabled ? theme.colors.success('✓ Enabled') : theme.colors.muted('○ Disabled');
        console.log(`${status} ${theme.colors.highlight(policy.name)} (priority: ${policy.priority})`);
      });
      console.log();
    } else {
      console.log(theme.colors.muted('No permission policies configured.\n'));
    }

    console.log(theme.colors.muted('Manage tool permissions:'));
    console.log(theme.colors.muted(' cortex permissions grant <tool>  - Allow a specific tool'));
    console.log(theme.colors.muted(' cortex permissions revoke <tool> - Block a specific tool'));
    console.log(theme.colors.muted(' cortex permissions policies      - List all active policies'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exitCode = 1;
  }
}
