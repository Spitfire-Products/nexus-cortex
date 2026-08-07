/**
 * UI Models Command
 * Launch interactive model picker
 */

import React from 'react';
import { render } from 'ink';
import { ModelPicker } from '../../ui/components/ModelPicker.js';
import { ConfigManager } from '@nexus-cortex/cli/dist/config/ConfigManager.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface UiModelsOptions {
  serverUrl?: string;
  json?: boolean;
  current?: string;
}

/**
 * Launch interactive model picker
 */
export async function uiModels(options: UiModelsOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();

  // JSON output not supported for interactive UI
  if (options.json) {
    console.error(theme.colors.error('Error: JSON output not supported for interactive UI'));
    console.log(theme.colors.muted('Use: cortex models list --json'));
    process.exit(1);
    return;
  }

  // Render the ModelPicker component
  const { unmount, waitUntilExit } = render(
    React.createElement(ModelPicker, {
      serverUrl,
      currentModel: options.current,
      onSelect: (model) => {
        unmount();
        console.log(theme.colors.success(`\n✓ Selected model: ${model.name}`));
        console.log(theme.colors.muted(`ID: ${model.id}`));
        console.log(theme.colors.muted(`Provider: ${model.provider}`));
        console.log(theme.colors.muted(`Context window: ${model.contextWindow} tokens`));
        console.log();
        console.log(theme.colors.info('To use this model in a new session:'));
        console.log(theme.colors.highlight(` cortex chat --model ${model.id}`));
        console.log();
        console.log(theme.colors.info('To switch model in current session:'));
        console.log(theme.colors.highlight(` cortex models switch <session-id> ${model.id}`));
        console.log();
      },
      onExit: () => {
        unmount();
        console.log(theme.colors.muted('\nExited model picker'));
      },
    })
  );

  // Wait for user interaction to complete
  await waitUntilExit();
}
