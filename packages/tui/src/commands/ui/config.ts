/**
 * Interactive configuration wizard command
 */

import React from 'react';
import { render } from 'ink';
import { ConfigWizard } from '../../ui/components/ConfigWizard.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';
import { CLIConfig } from '@nexus-cortex/cli/dist/config/ConfigManager.js';

export interface UiConfigOptions {
  /** JSON output format (not applicable for interactive component) */
  json?: boolean;
}

/**
 * Launch interactive configuration wizard
 */
export async function uiConfig(_options: UiConfigOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();

  const { unmount, waitUntilExit } = render(
    React.createElement(ConfigWizard, {
      onComplete: (_config: CLIConfig) => {
        unmount();
        console.log(theme.colors.success('\n✓ Configuration wizard completed'));
        console.log(theme.colors.muted(' Use "cortex config list" to view your settings'));
      },
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nConfiguration wizard cancelled'));
      },
    })
  );

  await waitUntilExit();
}
