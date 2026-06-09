/**
 * Sandbox Screenshot Command
 * Capture sandbox screenshot (alias for artifact inspect --screenshot)
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SandboxScreenshotOptions {
  serverUrl?: string;
  json?: boolean;
  output?: string;
}

/**
 * Capture sandbox screenshot
 */
export async function sandboxScreenshot(
  id?: string,
  options: SandboxScreenshotOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Sandbox ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex sandbox screenshot <id> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --output <path>    Save screenshot to file'));
      console.log(theme.colors.muted('\nExample:'));
      console.log(theme.colors.muted('  cortex sandbox screenshot dashboard-123 --output screenshot.png'));
      process.exit(1);
      return;
    }

    // Capture screenshot
    const payload: any = {
      id,
      screenshot: true
    };
    if (options.output) payload.output = options.output;

    const response = await client.post('/sandbox/screenshot', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Screenshot captured\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  ID: ${theme.colors.highlight(id)}`);

    if (response.path) {
      console.log(`  Saved to: ${theme.colors.highlight(response.path)}`);
    }

    if (response.size) {
      const sizeKB = (response.size / 1024).toFixed(2);
      console.log(`  Size: ${theme.colors.muted(sizeKB + ' KB')}`);
    }

    if (response.base64) {
      console.log(`  Data: ${theme.colors.muted('Base64 PNG available')}`);
      console.log(theme.colors.muted('  🎯 AI can now see the sandbox state visually!'));
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
