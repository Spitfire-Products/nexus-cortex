/**
 * Tmux Create Command
 * Creates a new tmux session with optional configuration
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface TmuxCreateOptions {
  serverUrl?: string;
  json?: boolean;
  name?: string;
  layout?: string;
  panes?: number;
}

/**
 * Create a new tmux session
 */
export async function tmuxCreate(options: TmuxCreateOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Prepare request payload
    const payload: any = {};
    if (options.name) payload.name = options.name;
    if (options.layout) payload.layout = options.layout;
    if (options.panes) payload.panes = options.panes;

    // Create tmux session
    const response = await client.post('/tmux/create', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Tmux session created successfully\n'));
    console.log(theme.colors.secondary('Session Details:'));
    console.log(`  Session ID: ${theme.colors.highlight(response.sessionId)}`);
    console.log(`  Name: ${theme.colors.highlight(response.name || 'default')}`);
    console.log(`  Layout: ${theme.colors.highlight(response.layout || 'even-horizontal')}`);
    console.log(`  Panes: ${theme.colors.highlight((response.panes || 1).toString())}`);

    if (response.createdAt) {
      console.log(`  Created: ${theme.colors.muted(response.createdAt)}`);
    }

    console.log();
    console.log(theme.colors.muted('Use the following commands to interact with this session:'));
    console.log(theme.colors.muted(`  cortex tmux send ${response.sessionId} "command"`));
    console.log(theme.colors.muted(`  cortex tmux capture ${response.sessionId}`));
    console.log(theme.colors.muted(`  cortex tmux snapshot ${response.sessionId}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
