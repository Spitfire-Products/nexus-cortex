/**
 * Templates Create Command
 * Create artifact from template
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface TemplatesCreateOptions {
  serverUrl?: string;
  json?: boolean;
  port?: number;
  mode?: string;
}

/**
 * Create artifact from template
 */
export async function templatesCreate(
  template?: string,
  name?: string,
  options: TemplatesCreateOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!template) {
      console.error(theme.colors.error('Error: Template name is required'));
      console.log(theme.colors.muted('\nUsage: cortex templates create <template> <name> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --port <port>       Port for web artifacts'));
      console.log(theme.colors.muted('  --mode <mode>       Execution mode (oneshot, dev, persistent)'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex templates create react-dashboard my-dashboard'));
      console.log(theme.colors.muted('  cortex templates create fastapi-server api --port 8000'));
      console.log();
      console.log(theme.colors.muted('List available templates with:'));
      console.log(theme.colors.muted('  cortex templates list'));
      process.exit(1);
      return;
    }

    if (!name) {
      console.error(theme.colors.error('Error: Artifact name is required'));
      console.log(theme.colors.muted('\nUsage: cortex templates create <template> <name> [options]'));
      process.exit(1);
      return;
    }

    // Build request payload
    const payload: any = {
      template: template.toLowerCase(),
      name
    };
    if (options.port) payload.port = options.port;
    if (options.mode) payload.mode = options.mode.toLowerCase();

    // Create from template
    const response = await client.post('/templates/create', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Artifact created from template\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Template: ${theme.colors.highlight(template)}`);
    console.log(`  Artifact: ${theme.colors.highlight(name)}`);

    if (response.id) {
      console.log(`  ID: ${theme.colors.highlight(response.id)}`);
    }

    if (response.type) {
      console.log(`  Type: ${theme.colors.highlight(response.type)}`);
    }

    if (response.url) {
      console.log(`  URL: ${theme.colors.highlight(response.url)}`);
    }

    if (response.port) {
      console.log(`  Port: ${theme.colors.highlight(response.port.toString())}`);
    }

    console.log();
    console.log(theme.colors.muted('Manage artifact with:'));
    console.log(theme.colors.muted('  cortex artifact list       - List all artifacts'));
    console.log(theme.colors.muted('  cortex artifact view <id>  - Open in browser'));
    console.log(theme.colors.muted('  cortex artifact inspect    - Inspect state'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
