/**
 * Artifact Dashboard Command
 * Open multi-artifact dashboard
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactDashboardOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Open multi-artifact dashboard
 */
export async function artifactDashboard(
  options: ArtifactDashboardOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get dashboard info
    const response = await client.get('/artifact/dashboard');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Opening artifact dashboard\n'));
    console.log(theme.colors.secondary('Multi-Artifact Dashboard'));

    if (response.url) {
      console.log(`  URL: ${theme.colors.highlight(response.url)}`);
    } else {
      console.log(`  URL: ${theme.colors.highlight('http://localhost:4001')}`);
    }

    if (response.artifacts) {
      console.log(`  Active Artifacts: ${theme.colors.highlight(response.artifacts.toString())}`);
    }

    console.log();
    console.log(theme.colors.muted('The dashboard provides:'));
    console.log(theme.colors.muted('  • Visual overview of all artifacts'));
    console.log(theme.colors.muted('  • Real-time status updates'));
    console.log(theme.colors.muted('  • Quick access to artifact controls'));
    console.log(theme.colors.muted('  • Resource usage monitoring'));
    console.log();

    if (response.message) {
      console.log(theme.colors.muted(response.message));
      console.log();
    }

    console.log(theme.colors.muted('Browser should open automatically.'));
    console.log(theme.colors.muted('If not, navigate to http://localhost:4001'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
