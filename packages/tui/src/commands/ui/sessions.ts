/**
 * UI Sessions Command
 * Launch interactive session browser
 */

import React from 'react';
import { render } from 'ink';
import { SessionBrowser } from '../../ui/components/SessionBrowser.js';
import { ConfigManager } from '@nexus-cortex/cli/dist/config/ConfigManager.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface UiSessionsOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Launch interactive session browser
 */
export async function uiSessions(options: UiSessionsOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();

  // JSON output not supported for interactive UI
  if (options.json) {
    console.error(theme.colors.error('Error: JSON output not supported for interactive UI'));
    console.log(theme.colors.muted('Use: cortex sessions list --json'));
    process.exit(1);
    return;
  }

  // Render the SessionBrowser component
  const { unmount, waitUntilExit } = render(
    React.createElement(SessionBrowser, {
      serverUrl,
      onSelect: (session) => {
        unmount();
        console.log(theme.colors.success(`\n✓ Selected session: ${session.id}`));
        console.log(theme.colors.muted(`Model: ${session.model}`));
        console.log(theme.colors.muted(`Messages: ${session.messageCount}`));
        console.log();
        console.log(theme.colors.info('To resume this session:'));
        console.log(theme.colors.highlight(` cortex session resume ${session.id}`));
        console.log();
      },
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited session browser'));
      },
    })
  );

  // Wait for user interaction to complete
  await waitUntilExit();
}
