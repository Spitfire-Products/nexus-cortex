/**
 * Interactive context viewer command
 */

import React from 'react';
import { render } from 'ink';
import { ContextViewer } from '../../ui/components/ContextViewer.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface UiContextOptions {
  /** Session ID */
  sessionId: string;
  /** Server URL */
  serverUrl?: string;
  /** JSON output format (not applicable for interactive component) */
  json?: boolean;
}

/**
 * Launch interactive context viewer
 */
export async function uiContext(options: UiContextOptions): Promise<void> {
  const theme = ThemeManager.getTheme();

  if (!options.sessionId) {
    console.error(theme.colors.error('Error: Session ID is required'));
    console.log(theme.colors.muted('\nUsage: cortex ui context --session-id <id>'));
    process.exit(1);
  }

  const { unmount, waitUntilExit } = render(
    React.createElement(ContextViewer, {
      sessionId: options.sessionId,
      serverUrl: options.serverUrl,
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited context viewer'));
      },
    })
  );

  await waitUntilExit();
}
