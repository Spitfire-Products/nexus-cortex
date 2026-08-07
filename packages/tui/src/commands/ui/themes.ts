/**
 * UI Themes Command
 * Launch interactive theme picker
 */

import React from 'react';
import { render } from 'ink';
import { ThemePicker } from '../../ui/components/ThemePicker.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface UiThemesOptions {
  json?: boolean;
}

/**
 * Launch interactive theme picker
 */
export async function uiThemes(options: UiThemesOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();

  // JSON output not supported for interactive UI
  if (options.json) {
    console.error(theme.colors.error('Error: JSON output not supported for interactive UI'));
    console.log(theme.colors.muted('Use: cortex config get theme'));
    process.exit(1);
    return;
  }

  // Render the ThemePicker component
  const { unmount, waitUntilExit } = render(
    React.createElement(ThemePicker, {
      onSelect: (themeName) => {
        unmount();
        const newTheme = ThemeManager.getTheme();
        console.log(newTheme.colors.success(`\n✓ Theme changed to: ${themeName}`));
        console.log(newTheme.colors.muted('Theme saved to configuration'));
        console.log();
        console.log(newTheme.colors.info('The new theme will be applied to all future commands.'));
        console.log();
      },
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited theme picker'));
      },
    })
  );

  // Wait for user interaction to complete
  await waitUntilExit();
}
