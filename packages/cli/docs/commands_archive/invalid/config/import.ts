/**
 * Config Import Command
 * Import configuration from file
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ConfigImportOptions {
  serverUrl?: string;
  json?: boolean;
  merge?: boolean;
}

/**
 * Import configuration from file
 */
export async function configImport(
  file?: string,
  options: ConfigImportOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!file) {
      console.error(theme.colors.error('Error: Configuration file is required'));
      console.log(theme.colors.muted('\nUsage: cortex config import <file> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --merge    Merge with existing configuration'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex config import config.json'));
      console.log(theme.colors.muted('  cortex config import config.yaml --merge'));
      console.log();
      process.exit(1);
      return;
    }

    // Import configuration
    const payload: any = { file };
    if (options.merge) payload.merge = true;

    const response = await client.post('/config/import', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Configuration imported\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  File: ${theme.colors.highlight(file)}`);
    console.log(`  Mode: ${theme.colors.highlight(options.merge ? 'Merged' : 'Replaced')}`);

    if (response.imported) {
      console.log(`  Settings imported: ${theme.colors.highlight(response.imported.toString())}`);
    }

    console.log();
    console.log(theme.colors.muted('Verify with: cortex config categories'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
