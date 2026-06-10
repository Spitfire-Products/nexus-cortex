/**
 * Display current permission mode and settings
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsModeOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show current permission mode
 */
export async function permissionsMode(options: PermissionsModeOptions = {}): Promise<void> {
  const envMode = process.env.CORTEX_MODE;
  const mode = envMode === 'server' ? 'server' : 'direct';
  const client = new OrchestratorClient({
    mode,
    serverUrl: options.serverUrl || ConfigManager.get('serverUrl'),
    debug: process.env.DEBUG === 'true',
  });
  const theme = ThemeManager.getTheme();

  try {
    const approvalMode = await client.getApprovalMode();

    if (options.json) {
      console.log(JSON.stringify(approvalMode, null, 2));
      return;
    }

    // Determine permission mode from approval settings
    let mode: string;

    if (approvalMode.yoloMode) {
      mode = 'auto';
    } else if (approvalMode.autoApproveActions) {
      mode = 'interactive';
    } else {
      mode = 'interactive';
    }

    console.log(theme.colors.primary('\nCurrent Permission Mode:'), theme.colors.highlight(mode));
    console.log();
    console.log(theme.colors.secondary('Available modes:'));
    console.log(theme.colors.muted(' interactive - Prompt user for approval on each tool execution'));
    console.log(theme.colors.muted(' auto        - Auto-approve all tools (YOLO mode)'));
    console.log(theme.colors.muted(' disabled    - No permission checks'));
    console.log();

    console.log(theme.colors.primary('Auto-Approve Actions:'),
      approvalMode.autoApproveActions
        ? theme.colors.success('enabled')
        : theme.colors.error('disabled')
    );

    if (approvalMode.yoloMode) {
      console.log();
      console.log(theme.colors.warning('⚠ YOLO Mode active - All actions are auto-approved!'));
    }

    if (approvalMode.context) {
      console.log();
      console.log(theme.colors.muted(`Context: ${approvalMode.context}`));
    }
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exitCode = 1;
  }
}
