/**
 * Tmux List Command
 * Lists all active tmux sessions
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface TmuxListOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List all tmux sessions
 */
export async function tmuxList(options: TmuxListOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Fetch tmux sessions
    const response = await client.get('/tmux/list');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    const sessions = response.sessions || [];

    console.log(theme.colors.primary(`\n Tmux Sessions (${sessions.length})\n`));

    if (sessions.length === 0) {
      console.log(theme.colors.muted('No active tmux sessions found.'));
      console.log();
      console.log(theme.colors.muted('Create a new session with:'));
      console.log(theme.colors.muted(' cortex tmux create --name my-session'));
      console.log();
      return;
    }

    for (const session of sessions) {
      console.log(theme.colors.secondary(`Session: ${session.id || session.name}`));

      if (session.name && session.name !== session.id) {
        console.log(` Name: ${theme.colors.highlight(session.name)}`);
      }

      if (session.layout) {
        console.log(` Layout: ${theme.colors.muted(session.layout)}`);
      }

      if (session.panes !== undefined) {
        console.log(` Panes: ${theme.colors.highlight(session.panes.toString())}`);
      }

      if (session.createdAt) {
        console.log(` Created: ${theme.colors.muted(formatDate(session.createdAt))}`);
      }

      if (session.active !== undefined) {
        const status = session.active ? theme.colors.success('✓ Active') : theme.colors.muted('○ Inactive');
        console.log(` Status: ${status}`);
      }

      console.log();
    }

    console.log(theme.colors.muted('Use these commands to interact with sessions:'));
    console.log(theme.colors.muted(' cortex tmux send <session-id> "command"'));
    console.log(theme.colors.muted(' cortex tmux capture <session-id>'));
    console.log(theme.colors.muted(' cortex tmux snapshot <session-id>'));
    console.log(theme.colors.muted(' cortex tmux kill <session-id>'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
