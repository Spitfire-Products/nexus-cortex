/**
 * Artifact Stop Command
 * Stop a running artifact
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactStopOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Stop artifact
 */
export async function artifactStop(
  id?: string,
  options: ArtifactStopOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Artifact ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex artifact stop <id>'));
      console.log(theme.colors.muted('\nExample:'));
      console.log(theme.colors.muted(' cortex artifact stop dashboard-123'));
      process.exit(1);
      return;
    }

    // Stop artifact
    const response = await client.post('/artifact/stop', { id });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Artifact stopped successfully\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(` ID: ${theme.colors.highlight(id)}`);

    if (response.message) {
      console.log(` Message: ${theme.colors.muted(response.message)}`);
    }

    console.log();
    console.log(theme.colors.muted('Restart with:'));
    console.log(theme.colors.muted(` cortex artifact restart ${id}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
