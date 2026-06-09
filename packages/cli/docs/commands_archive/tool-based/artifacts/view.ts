/**
 * Artifact View Command
 * Open artifact in browser
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactViewOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Open artifact in browser
 */
export async function artifactView(
  id?: string,
  options: ArtifactViewOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Artifact ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex artifact view <id>'));
      console.log(theme.colors.muted('\nExample:'));
      console.log(theme.colors.muted('  cortex artifact view dashboard-123'));
      process.exit(1);
      return;
    }

    // Get artifact details
    const response = await client.get(`/artifact/view/${id}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Opening artifact in browser\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  ID: ${theme.colors.highlight(id)}`);

    if (response.url) {
      console.log(`  URL: ${theme.colors.highlight(response.url)}`);
    }

    if (response.port) {
      console.log(`  Port: ${theme.colors.highlight(response.port.toString())}`);
    }

    if (response.message) {
      console.log(`  ${theme.colors.muted(response.message)}`);
    }

    console.log();
    console.log(theme.colors.muted('Browser should open automatically.'));
    console.log(theme.colors.muted('If not, navigate to the URL above.'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
