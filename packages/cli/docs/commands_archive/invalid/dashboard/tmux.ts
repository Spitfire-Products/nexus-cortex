/**
 * Dashboard Tmux Command
 * Open tmux dashboard
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface DashboardTmuxOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Open tmux dashboard
 */
export async function dashboardTmux(
  options: DashboardTmuxOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get tmux dashboard info
    const response = await client.get('/dashboard/tmux');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n🖥️  Tmux Dashboard\n'));

    if (response.url) {
      console.log(`  URL: ${theme.colors.highlight(response.url)}`);
      console.log();
      console.log(theme.colors.success('Opening tmux dashboard in browser...'));
    }

    if (response.port) {
      console.log(`  Port: ${theme.colors.highlight(response.port.toString())}`);
    }

    if (response.activeSessions !== undefined) {
      console.log(`  Active sessions: ${theme.colors.highlight(response.activeSessions.toString())}`);
    }

    console.log();
    console.log(theme.colors.muted('The tmux dashboard provides:'));
    console.log(theme.colors.muted('  • Live terminal view'));
    console.log(theme.colors.muted('  • Session management'));
    console.log(theme.colors.muted('  • Command history'));
    console.log(theme.colors.muted('  • Visual snapshots'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
