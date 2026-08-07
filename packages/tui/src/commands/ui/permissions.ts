/**
 * Interactive permissions browser command
 */

import React from 'react';
import { render } from 'ink';
import { PermissionsBrowser } from '../../ui/components/PermissionsBrowser.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface UiPermissionsOptions {
  /** Server URL */
  serverUrl?: string;
  /** JSON output format (not applicable for interactive component) */
  json?: boolean;
}

/**
 * Launch interactive permissions browser
 */
export async function uiPermissions(options: UiPermissionsOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();

  const { unmount, waitUntilExit } = render(
    React.createElement(PermissionsBrowser, {
      serverUrl: options.serverUrl,
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited permissions browser'));
      },
    })
  );

  await waitUntilExit();
}
