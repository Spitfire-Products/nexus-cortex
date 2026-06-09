/**
 * Tmux Capture Command
 * Captures output from a tmux session
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface TmuxCaptureOptions {
  serverUrl?: string;
  json?: boolean;
  lines?: number;
  pane?: string;
}

/**
 * Capture output from a tmux session
 */
export async function tmuxCapture(
  sessionId?: string,
  options: TmuxCaptureOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!sessionId) {
      console.error(theme.colors.error('Error: Session ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex tmux capture <session-id> [options]'));
      console.log(theme.colors.muted('Example: cortex tmux capture dev-session --lines 100'));
      process.exit(1);
      return;
    }

    // Build query parameters
    const params = new URLSearchParams();
    if (options.lines) params.append('lines', options.lines.toString());
    if (options.pane) params.append('pane', options.pane);

    const query = params.toString();
    const endpoint = query ? `/tmux/capture/${sessionId}?${query}` : `/tmux/capture/${sessionId}`;

    // Capture output
    const response = await client.get(endpoint);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n📺 Tmux Session Output: ${sessionId}\n`));

    if (response.paneId) {
      console.log(theme.colors.secondary(`Pane: ${response.paneId}`));
    }

    if (response.lines !== undefined) {
      console.log(theme.colors.secondary(`Lines: ${response.lines}`));
    }

    console.log(theme.colors.muted('─'.repeat(60)));
    console.log();

    if (response.output) {
      console.log(response.output);
    } else {
      console.log(theme.colors.muted('(No output captured)'));
    }

    console.log();
    console.log(theme.colors.muted('─'.repeat(60)));

    if (response.timestamp) {
      console.log(theme.colors.muted(`Captured at: ${response.timestamp}`));
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
