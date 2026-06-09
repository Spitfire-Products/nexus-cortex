/**
 * Config Validate Command
 * Validate configuration
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ConfigValidateOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Validate configuration
 */
export async function configValidate(
  options: ConfigValidateOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validate configuration
    const response = await client.post('/config/validate', {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n✓ Configuration Validation\n'));

    if (response.valid) {
      console.log(theme.colors.success('Status: Valid ✓'));
    } else {
      console.log(theme.colors.error('Status: Invalid ✗'));
    }

    if (response.errors && response.errors.length > 0) {
      console.log();
      console.log(theme.colors.secondary('Errors:'));
      response.errors.forEach((error: string) => {
        console.log(`  ${theme.colors.error('✗')} ${error}`);
      });
    }

    if (response.warnings && response.warnings.length > 0) {
      console.log();
      console.log(theme.colors.secondary('Warnings:'));
      response.warnings.forEach((warning: string) => {
        console.log(`  ${theme.colors.warning('⚠')} ${warning}`);
      });
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
