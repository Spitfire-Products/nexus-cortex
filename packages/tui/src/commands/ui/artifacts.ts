/**
 * Interactive artifacts dashboard command
 */

import React from 'react';
import { render } from 'ink';
import { ArtifactDashboard } from '../../ui/components/ArtifactDashboard.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface UiArtifactsOptions {
  /** Server URL */
  serverUrl?: string;
  /** JSON output format (not applicable for interactive component) */
  json?: boolean;
}

/**
 * Launch interactive artifacts dashboard
 */
export async function uiArtifacts(options: UiArtifactsOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();

  const { unmount, waitUntilExit } = render(
    React.createElement(ArtifactDashboard, {
      serverUrl: options.serverUrl,
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited artifacts dashboard'));
      },
    })
  );

  await waitUntilExit();
}
