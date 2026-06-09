/**
 * Tmux Send Command
 * Sends a command to a tmux session
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface TmuxSendOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Send a command to a tmux session
 */
export async function tmuxSend(
  sessionId?: string,
  command?: string,
  options: TmuxSendOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!sessionId) {
      console.error(theme.colors.error('Error: Session ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex tmux send <session-id> <command>'));
      console.log(theme.colors.muted('Example: cortex tmux send dev-session "npm test"'));
      process.exit(1);
      return;
    }

    if (!command) {
      console.error(theme.colors.error('Error: Command is required'));
      console.log(theme.colors.muted('\nUsage: cortex tmux send <session-id> <command>'));
      console.log(theme.colors.muted('Example: cortex tmux send dev-session "npm test"'));
      process.exit(1);
      return;
    }

    // Send command to tmux session
    const response = await client.post('/tmux/send', {
      sessionId,
      command
    });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Command sent to tmux session\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Session: ${theme.colors.highlight(sessionId)}`);
    console.log(`  Command: ${theme.colors.highlight(command)}`);
    console.log(`  Status: ${theme.colors.success(response.status || 'executed')}`);

    if (response.paneId) {
      console.log(`  Pane ID: ${theme.colors.muted(response.paneId)}`);
    }

    console.log();
    console.log(theme.colors.muted('Capture output with:'));
    console.log(theme.colors.muted(`  cortex tmux capture ${sessionId}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
