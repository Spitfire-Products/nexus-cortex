/**
 * Session History Command
 * View compaction history
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SessionHistoryOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * View session compaction history
 */
export async function sessionHistory(
  id?: string,
  options: SessionHistoryOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Session ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex sessions history <id>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex sessions history abc-123'));
      console.log();
      process.exit(1);
      return;
    }

    // Get compaction history
    const response = await client.get(`/sessions/${id}/history`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📜 Compaction History\n'));
    console.log(theme.colors.secondary('Session:'));
    console.log(`  ID: ${theme.colors.highlight(id)}`);
    console.log();

    if (response.compactions && response.compactions.length > 0) {
      console.log(theme.colors.secondary('Compaction Events:'));
      response.compactions.forEach((event: any, index: number) => {
        console.log(`  ${index + 1}. ${event.timestamp}`);
        console.log(`     Tokens: ${event.tokensBefore} → ${event.tokensAfter} (${theme.colors.success('-' + event.reduction + '%')})`);
      });
    } else {
      console.log(theme.colors.muted('No compaction events yet.'));
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
