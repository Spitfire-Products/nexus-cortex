/**
 * Session Compact Command
 * Manually trigger compaction
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SessionCompactOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Manually trigger session compaction
 */
export async function sessionCompact(
  id?: string,
  options: SessionCompactOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Session ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex sessions compact <id>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted(' cortex sessions compact abc-123'));
      console.log();
      process.exit(1);
      return;
    }

    // Trigger compaction
    const response = await client.post(`/sessions/${id}/compaction`, {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Session compacted\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(` Session ID: ${theme.colors.highlight(id)}`);

    if (response.tokensBefore) {
      console.log(` Tokens before: ${theme.colors.highlight(response.tokensBefore.toString())}`);
    }

    if (response.tokensAfter) {
      console.log(` Tokens after: ${theme.colors.highlight(response.tokensAfter.toString())}`);
    }

    if (response.reduction) {
      console.log(` Reduction: ${theme.colors.success(response.reduction + '%')}`);
    }

    console.log();
    console.log(theme.colors.muted('View session: cortex sessions view ' + id));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
