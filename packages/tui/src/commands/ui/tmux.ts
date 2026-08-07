/**
 * Tmux browser UI command
 */
import React from 'react';
import { render } from 'ink';
import { TmuxBrowser } from '../../ui/components/TmuxBrowser.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface TmuxBrowserOptions {
  serverUrl?: string;
}

export async function tmuxBrowser(options: TmuxBrowserOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();

  const { unmount, waitUntilExit } = render(
    React.createElement(TmuxBrowser, {
      serverUrl: options.serverUrl,
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited tmux browser'));
      },
    })
  );

  await waitUntilExit();
}
