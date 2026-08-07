/**
 * Interactive middleware dashboard command
 */

import React from 'react';
import { render } from 'ink';
import { MiddlewareDashboard } from '../../ui/components/MiddlewareDashboard.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface UiMiddlewareOptions {
  /** Server URL */
  serverUrl?: string;
  /** JSON output format (not applicable for interactive component) */
  json?: boolean;
}

/**
 * Launch interactive middleware dashboard
 */
export async function uiMiddleware(options: UiMiddlewareOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();

  const { unmount, waitUntilExit } = render(
    React.createElement(MiddlewareDashboard, {
      serverUrl: options.serverUrl,
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited middleware dashboard'));
      },
    })
  );

  await waitUntilExit();
}
