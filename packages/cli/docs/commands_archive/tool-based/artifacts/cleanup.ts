/**
 * Artifact Cleanup Command
 * Clean up stopped artifacts and release resources
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactCleanupOptions {
  serverUrl?: string;
  json?: boolean;
  force?: boolean;
}

/**
 * Clean up stopped artifacts
 */
export async function artifactCleanup(
  options: ArtifactCleanupOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Build request payload
    const payload: any = {};
    if (options.force) payload.force = true;

    // Clean up artifacts
    const response = await client.post('/artifact/cleanup', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Cleanup completed\n'));

    if (response.cleaned) {
      console.log(theme.colors.secondary('Cleaned Resources:'));
      console.log(`  Artifacts removed: ${theme.colors.highlight(response.cleaned.toString())}`);

      if (response.portsReleased) {
        console.log(`  Ports released: ${theme.colors.muted(response.portsReleased.toString())}`);
      }

      if (response.tmuxPanesRemoved) {
        console.log(`  Tmux panes removed: ${theme.colors.muted(response.tmuxPanesRemoved.toString())}`);
      }

      if (response.containersRemoved) {
        console.log(`  Containers removed: ${theme.colors.muted(response.containersRemoved.toString())}`);
      }
    } else {
      console.log(theme.colors.muted('No artifacts to clean up.'));
    }

    console.log();

    if (response.message) {
      console.log(theme.colors.muted(response.message));
      console.log();
    }

    console.log(theme.colors.muted('View remaining artifacts with:'));
    console.log(theme.colors.muted('  cortex artifact list'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
