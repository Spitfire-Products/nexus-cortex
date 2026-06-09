/**
 * Dashboard Sandbox Command
 * Open sandbox dashboard
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface DashboardSandboxOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Open sandbox dashboard
 */
export async function dashboardSandbox(
  options: DashboardSandboxOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get sandbox dashboard info
    const response = await client.get('/dashboard/sandbox');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n🎨 Sandbox Dashboard\n'));

    if (response.url) {
      console.log(`  URL: ${theme.colors.highlight(response.url)}`);
      console.log();
      console.log(theme.colors.success('Opening sandbox dashboard in browser...'));
    }

    if (response.port) {
      console.log(`  Port: ${theme.colors.highlight(response.port.toString())}`);
    }

    if (response.activeArtifacts !== undefined) {
      console.log(`  Active artifacts: ${theme.colors.highlight(response.activeArtifacts.toString())}`);
    }

    console.log();
    console.log(theme.colors.muted('The sandbox dashboard provides:'));
    console.log(theme.colors.muted('  • Multi-artifact view'));
    console.log(theme.colors.muted('  • Live screenshots'));
    console.log(theme.colors.muted('  • Console logs'));
    console.log(theme.colors.muted('  • Resource monitoring'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
