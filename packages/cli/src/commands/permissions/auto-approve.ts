/**
 * Toggle auto-approve actions mode
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsAutoApproveOptions {
  serverUrl?: string;
  enable?: boolean;
  disable?: boolean;
}

/**
 * Toggle auto-approve actions
 */
export async function permissionsAutoApprove(
  options: PermissionsAutoApproveOptions = {}
): Promise<void> {
  const envMode = process.env.CORTEX_MODE;
  const mode = envMode === 'server' ? 'server' : 'direct';
  const client = new OrchestratorClient({
    mode,
    serverUrl: options.serverUrl || ConfigManager.get('serverUrl'),
    debug: process.env.DEBUG === 'true',
  });
  const theme = ThemeManager.getTheme();

  try {
    // Get current mode
    const currentMode = await client.getApprovalMode();

    let newAutoApprove: boolean;

    if (options.enable) {
      newAutoApprove = true;
    } else if (options.disable) {
      newAutoApprove = false;
    } else {
      // Toggle current state
      newAutoApprove = !currentMode.autoApproveActions;
    }

    // Set new mode
    const result = await client.setApprovalMode(newAutoApprove);

    // Display result
    if (newAutoApprove) {
      console.log(theme.colors.success('✓ Auto-approve actions: ') + theme.colors.highlight('enabled'));
      console.log(theme.colors.warning('\n⚠ Warning: Tool executions will be auto-approved!'));
    } else {
      console.log(theme.colors.success('✓ Auto-approve actions: ') + theme.colors.highlight('disabled'));
      console.log(theme.colors.muted('\nYou will be prompted for approval on each tool execution.'));
    }

    if (result.message) {
      console.log(theme.colors.muted(`\n${result.message}`));
    }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exitCode = 1;
  }
}
