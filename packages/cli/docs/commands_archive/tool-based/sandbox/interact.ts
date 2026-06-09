/**
 * Sandbox Interact Command
 * Interact with sandbox (alias for artifact interact)
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SandboxInteractOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Interact with sandbox
 */
export async function sandboxInteract(
  id?: string,
  action?: string,
  args?: string[],
  options: SandboxInteractOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Sandbox ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex sandbox interact <id> <action> [args...]'));
      console.log(theme.colors.muted('\nActions:'));
      console.log(theme.colors.muted('  click <selector>           - Click element'));
      console.log(theme.colors.muted('  fill <selector> <value>    - Fill input'));
      console.log(theme.colors.muted('  select <selector> <value>  - Select option'));
      console.log(theme.colors.muted('  goto <url>                 - Navigate to URL'));
      console.log(theme.colors.muted('  scroll <direction>         - Scroll page'));
      console.log(theme.colors.muted('\nExample:'));
      console.log(theme.colors.muted('  cortex sandbox interact dashboard-123 click "#submit-btn"'));
      process.exit(1);
      return;
    }

    if (!action) {
      console.error(theme.colors.error('Error: Action is required'));
      console.log(theme.colors.muted('\nUsage: cortex sandbox interact <id> <action> [args...]'));
      process.exit(1);
      return;
    }

    // Build request payload
    const payload: any = {
      id,
      action: action.toLowerCase(),
      args: args || []
    };

    // Interact with sandbox
    const response = await client.post('/sandbox/interact', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Interaction completed\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  ID: ${theme.colors.highlight(id)}`);
    console.log(`  Action: ${theme.colors.highlight(action)}`);

    if (args && args.length > 0) {
      console.log(`  Arguments: ${theme.colors.muted(args.join(', '))}`);
    }

    if (response.result) {
      console.log(`  Result: ${theme.colors.muted(JSON.stringify(response.result))}`);
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
