/**
 * Context Boundaries Command
 * List compaction boundaries
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ContextBoundariesOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List compaction boundaries
 */
export async function contextBoundaries(
  sessionId: string,
  options: ContextBoundariesOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get boundaries
    const response = await client.get(`/sessions/${sessionId}/compaction/boundaries`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n Compaction Boundaries\n'));

    if (response.boundaries && response.boundaries.length > 0) {
      response.boundaries.forEach((boundary: any, index: number) => {
        console.log(theme.colors.secondary(`Boundary ${index + 1}:`));
        console.log(` Turn: ${theme.colors.highlight(boundary.turn.toString())}`);
        console.log(` Timestamp: ${theme.colors.muted(boundary.timestamp)}`);
        console.log(` Tokens saved: ${theme.colors.success(boundary.tokensSaved.toString())}`);
        console.log();
      });
    } else {
      console.log(theme.colors.muted('No compaction boundaries yet.'));
      console.log();
    }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
