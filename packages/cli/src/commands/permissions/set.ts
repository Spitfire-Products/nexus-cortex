/**
 * Set permission mode (interactive/auto/disabled)
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsSetOptions {
  serverUrl?: string;
}

type PermissionMode = 'interactive' | 'auto' | 'disabled';

/**
 * Set permission mode
 */
export async function permissionsSet(
  mode: PermissionMode,
  options: PermissionsSetOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  // Validate mode
  const validModes: PermissionMode[] = ['interactive', 'auto', 'disabled'];
  if (!validModes.includes(mode)) {
    console.error(theme.colors.error(`Invalid mode: ${mode}`));
    console.error(theme.colors.muted('Valid modes: interactive, auto, disabled'));
    process.exit(1);
  }

  try {
    // Map CLI mode to server settings
    let autoApproveActions: boolean;

    switch (mode) {
      case 'interactive':
        autoApproveActions = false;
        break;
      case 'auto':
        autoApproveActions = true;
        break;
      case 'disabled':
        // Disabled means no permission checks, same as auto
        autoApproveActions = true;
        break;
    }

    // Set the approval mode
    const result = await client.setApprovalMode(autoApproveActions);

    console.log(theme.colors.success(`✓ Permission mode set to: ${mode}`));

    if (mode === 'auto' || mode === 'disabled') {
      console.log(theme.colors.warning('\n⚠ Warning: All tool executions will be auto-approved!'));
    }

    if (result.message) {
      console.log(theme.colors.muted(`\n${result.message}`));
    }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
