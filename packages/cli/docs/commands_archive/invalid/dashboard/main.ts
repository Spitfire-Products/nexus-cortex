/**
 * Dashboard Main Command
 * Open main dashboard
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface DashboardMainOptions {
  serverUrl?: string;
  json?: boolean;
  port?: number;
}

/**
 * Open main dashboard
 */
export async function dashboardMain(
  options: DashboardMainOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get dashboard info
    const response = await client.get('/dashboard');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📊 Dashboard\n'));

    if (response.url) {
      console.log(`  URL: ${theme.colors.highlight(response.url)}`);
      console.log();
      console.log(theme.colors.success('Opening dashboard in browser...'));
    }

    if (response.port) {
      console.log(`  Port: ${theme.colors.highlight(response.port.toString())}`);
    }

    console.log();
    console.log(theme.colors.muted('The dashboard provides a web-based interface for:'));
    console.log(theme.colors.muted('  • Session management'));
    console.log(theme.colors.muted('  • Real-time statistics'));
    console.log(theme.colors.muted('  • Model selection'));
    console.log(theme.colors.muted('  • Configuration'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
