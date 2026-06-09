/**
 * Tmux Kill Command
 * Terminates a tmux session
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface TmuxKillOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Kill a tmux session
 */
export async function tmuxKill(
  sessionId?: string,
  options: TmuxKillOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!sessionId) {
      console.error(theme.colors.error('Error: Session ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex tmux kill <session-id>'));
      console.log(theme.colors.muted('Example: cortex tmux kill dev-session'));
      process.exit(1);
      return;
    }

    // Kill tmux session
    const response = await client.post('/tmux/kill', { sessionId });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Tmux session terminated\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Session: ${theme.colors.highlight(sessionId)}`);
    console.log(`  Status: ${theme.colors.success(response.status || 'terminated')}`);

    if (response.message) {
      console.log(`  Message: ${theme.colors.muted(response.message)}`);
    }

    console.log();
    console.log(theme.colors.muted('List remaining sessions with:'));
    console.log(theme.colors.muted('  cortex tmux list'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
