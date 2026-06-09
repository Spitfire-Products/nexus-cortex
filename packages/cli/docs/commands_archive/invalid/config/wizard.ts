/**
 * Config Wizard Command
 * Interactive configuration wizard
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ConfigWizardOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Interactive configuration wizard
 */
export async function configWizard(
  options: ConfigWizardOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Start configuration wizard
    const response = await client.post('/config/wizard', {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n🧙 Configuration Wizard\n'));
    console.log(theme.colors.secondary('Wizard guidance:'));

    if (response.steps) {
      response.steps.forEach((step: any, index: number) => {
        console.log(`  ${index + 1}. ${step.description}`);
        if (step.currentValue) {
          console.log(`     Current: ${theme.colors.highlight(step.currentValue)}`);
        }
        if (step.recommended) {
          console.log(`     Recommended: ${theme.colors.success(step.recommended)}`);
        }
      });
    }

    console.log();
    console.log(theme.colors.muted('Use the wizard to configure Cortex interactively.'));
    console.log(theme.colors.muted('Run: cortex config wizard --interactive'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
