/**
 * Context Compact Command
 * Trigger manual compaction
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ContextCompactOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Trigger manual compaction
 */
export async function contextCompact(
  sessionId: string,
  options: ContextCompactOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Trigger compaction
    const response = await client.post(`/sessions/${sessionId}/compaction`, {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Compaction complete\n'));

    if (response.tokensBefore && response.tokensAfter) {
      console.log(theme.colors.secondary('Results:'));
      console.log(` Tokens before: ${theme.colors.highlight(response.tokensBefore.toString())}`);
      console.log(` Tokens after: ${theme.colors.highlight(response.tokensAfter.toString())}`);

      const saved = response.tokensBefore - response.tokensAfter;
      const percentage = ((saved / response.tokensBefore) * 100).toFixed(1);
      console.log(` Saved: ${theme.colors.success(saved.toString() + ' tokens (' + percentage + '%)')}`);
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
