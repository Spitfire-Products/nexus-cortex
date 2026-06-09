/**
 * Tmux Snapshot Command
 * Captures a visual snapshot (base64 PNG) of a tmux session
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface TmuxSnapshotOptions {
  serverUrl?: string;
  json?: boolean;
  output?: string;
}

/**
 * Capture a visual snapshot of a tmux session
 */
export async function tmuxSnapshot(
  sessionId?: string,
  options: TmuxSnapshotOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!sessionId) {
      console.error(theme.colors.error('Error: Session ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex tmux snapshot <session-id> [options]'));
      console.log(theme.colors.muted('Example: cortex tmux snapshot dev-session --output snapshot.png'));
      process.exit(1);
      return;
    }

    // Build query parameters
    const params = new URLSearchParams();
    if (options.output) params.append('output', options.output);

    const query = params.toString();
    const endpoint = query ? `/tmux/snapshot/${sessionId}?${query}` : `/tmux/snapshot/${sessionId}`;

    // Capture snapshot
    const response = await client.get(endpoint);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Visual snapshot captured\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Session: ${theme.colors.highlight(sessionId)}`);

    if (response.timestamp) {
      console.log(`  Captured: ${theme.colors.muted(response.timestamp)}`);
    }

    if (response.width && response.height) {
      console.log(`  Dimensions: ${theme.colors.highlight(`${response.width}x${response.height}`)}`);
    }

    if (response.format) {
      console.log(`  Format: ${theme.colors.highlight(response.format)}`);
    }

    if (response.imageData) {
      const dataLength = response.imageData.length;
      console.log(`  Data Size: ${theme.colors.highlight((dataLength / 1024).toFixed(2) + ' KB')}`);
    }

    if (response.filePath) {
      console.log(`  Saved to: ${theme.colors.success(response.filePath)}`);
    } else if (response.imageData) {
      console.log();
      console.log(theme.colors.muted('Base64 image data available in JSON output (use --json flag)'));
    }

    console.log();
    console.log(theme.colors.muted('Revolutionary feature: AI can now see terminal state visually!'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
