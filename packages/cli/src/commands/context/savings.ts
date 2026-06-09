/**
 * Context Savings Command
 * Show token savings from compaction
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ContextSavingsOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show token savings from compaction
 */
export async function contextSavings(
  options: ContextSavingsOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get savings data
    const response = await client.get('/context/savings');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n Token Savings\n'));

    if (response.totalSaved) {
      console.log(theme.colors.secondary('Summary:'));
      console.log(` Total saved: ${theme.colors.success(response.totalSaved.toString() + ' tokens')}`);

      if (response.compactionCount) {
        console.log(` Compactions: ${theme.colors.highlight(response.compactionCount.toString())}`);
      }

      if (response.averageReduction) {
        console.log(` Avg reduction: ${theme.colors.success(response.averageReduction + '%')}`);
      }

      if (response.costSaved) {
        console.log(` Cost saved: ${theme.colors.success('$' + response.costSaved.toFixed(2))}`);
      }
    } else {
      console.log(theme.colors.muted('No compaction savings yet.'));
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
