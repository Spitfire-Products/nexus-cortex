/**
 * System message browser UI command
 */
import React from 'react';
import { render } from 'ink';
import { SystemMessageBrowser } from '../../ui/components/SystemMessageBrowser.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface SystemMessageBrowserOptions {
  serverUrl?: string;
}

export async function systemMessageBrowser(options: SystemMessageBrowserOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();

  const { unmount, waitUntilExit } = render(
    React.createElement(SystemMessageBrowser, {
      serverUrl: options.serverUrl,
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited system message browser'));
      },
    })
  );

  await waitUntilExit();
}
