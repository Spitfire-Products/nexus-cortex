/**
 * Artifact Create Command
 * Creates a new artifact with specified configuration
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactCreateOptions {
  serverUrl?: string;
  json?: boolean;
  type?: string;
  mode?: string;
  port?: number;
  env?: string;
  code?: string;
}

/**
 * Create a new artifact
 */
export async function artifactCreate(
  name?: string,
  options: ArtifactCreateOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!name) {
      console.error(theme.colors.error('Error: Artifact name is required'));
      console.log(theme.colors.muted('\nUsage: cortex artifact create <name> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --type <type>       Artifact type (js, ts, python, rust, go, shell, html)'));
      console.log(theme.colors.muted('  --mode <mode>       Execution mode (oneshot, dev, persistent)'));
      console.log(theme.colors.muted('  --port <port>       Port for web artifacts'));
      console.log(theme.colors.muted('  --env <env>         Environment (docker, local, nix)'));
      console.log(theme.colors.muted('  --code <code>       Initial code (optional)'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex artifact create dashboard --type react --port 3000'));
      console.log(theme.colors.muted('  cortex artifact create analysis --type python --mode dev'));
      process.exit(1);
      return;
    }

    // Validate type if provided
    const validTypes = ['js', 'ts', 'python', 'rust', 'go', 'shell', 'html', 'react', 'vue', 'nextjs'];
    if (options.type && !validTypes.includes(options.type.toLowerCase())) {
      console.error(theme.colors.error(`Error: Invalid artifact type '${options.type}'`));
      console.log(theme.colors.muted('\nValid types: ' + validTypes.join(', ')));
      process.exit(1);
      return;
    }

    // Validate mode if provided
    const validModes = ['oneshot', 'dev', 'persistent'];
    if (options.mode && !validModes.includes(options.mode.toLowerCase())) {
      console.error(theme.colors.error(`Error: Invalid mode '${options.mode}'`));
      console.log(theme.colors.muted('\nValid modes: ' + validModes.join(', ')));
      process.exit(1);
      return;
    }

    // Validate env if provided
    const validEnvs = ['docker', 'local', 'nix'];
    if (options.env && !validEnvs.includes(options.env.toLowerCase())) {
      console.error(theme.colors.error(`Error: Invalid environment '${options.env}'`));
      console.log(theme.colors.muted('\nValid environments: ' + validEnvs.join(', ')));
      process.exit(1);
      return;
    }

    // Build request payload
    const payload: any = { name };
    if (options.type) payload.type = options.type.toLowerCase();
    if (options.mode) payload.mode = options.mode.toLowerCase();
    if (options.port) payload.port = options.port;
    if (options.env) payload.env = options.env.toLowerCase();
    if (options.code) payload.code = options.code;

    // Create artifact
    const response = await client.post('/artifact/create', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Artifact created successfully\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  ID: ${theme.colors.highlight(response.id || 'N/A')}`);
    console.log(`  Name: ${theme.colors.highlight(name)}`);

    if (response.type) {
      console.log(`  Type: ${theme.colors.highlight(response.type)}`);
    }

    if (response.mode) {
      console.log(`  Mode: ${theme.colors.highlight(response.mode)}`);
    }

    if (response.port) {
      console.log(`  Port: ${theme.colors.highlight(response.port.toString())}`);
    }

    if (response.url) {
      console.log(`  URL: ${theme.colors.highlight(response.url)}`);
    }

    if (response.status) {
      console.log(`  Status: ${theme.colors.highlight(response.status)}`);
    }

    console.log();
    console.log(theme.colors.muted('Manage artifacts with:'));
    console.log(theme.colors.muted('  cortex artifact list       - List all artifacts'));
    console.log(theme.colors.muted('  cortex artifact inspect    - Inspect artifact'));
    console.log(theme.colors.muted('  cortex artifact view       - Open in browser'));
    console.log(theme.colors.muted('  cortex artifact dashboard  - View all artifacts'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
