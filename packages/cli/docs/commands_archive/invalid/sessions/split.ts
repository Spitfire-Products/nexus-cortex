/**
 * Session Split Command
 * Split session at specified turn
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SessionSplitOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Split session at specified turn
 */
export async function sessionSplit(
  id?: string,
  turn?: string,
  options: SessionSplitOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Session ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex sessions split <id> <turn>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex sessions split abc-123 10'));
      console.log();
      process.exit(1);
      return;
    }

    if (!turn) {
      console.error(theme.colors.error('Error: Turn number is required'));
      console.log(theme.colors.muted('\nUsage: cortex sessions split <id> <turn>'));
      process.exit(1);
      return;
    }

    // Split session
    const response = await client.post('/sessions/split', {
      id,
      turn: parseInt(turn, 10)
    });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Session split\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Original ID: ${theme.colors.highlight(id)}`);
    console.log(`  Split at turn: ${theme.colors.highlight(turn)}`);
    console.log();
    console.log(`  Session 1 ID: ${theme.colors.highlight(response.session1)}`);
    console.log(`  Session 2 ID: ${theme.colors.highlight(response.session2)}`);

    console.log();
    console.log(theme.colors.muted('View sessions:'));
    console.log(theme.colors.muted('  cortex sessions view ' + response.session1));
    console.log(theme.colors.muted('  cortex sessions view ' + response.session2));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
