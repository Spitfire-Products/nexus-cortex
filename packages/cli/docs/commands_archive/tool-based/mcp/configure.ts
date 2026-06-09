/**
 * Configure MCP server settings
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface McpConfigureOptions {
  serverUrl?: string;
  env?: Record<string, string>;
  args?: string[];
  timeout?: number;
  maxRetries?: number;
}

/**
 * Configure MCP server settings
 */
export async function mcpConfigure(
  serverName: string,
  options: McpConfigureOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    console.log(theme.colors.secondary(`\nConfiguring MCP server: ${serverName}...\n`));

    // Build configuration payload
    const config: any = {};

    if (options.env) {
      config.env = options.env;
    }

    if (options.args) {
      config.args = options.args;
    }

    if (options.timeout !== undefined) {
      config.timeout = options.timeout;
    }

    if (options.maxRetries !== undefined) {
      config.maxRetries = options.maxRetries;
    }

    if (Object.keys(config).length === 0) {
      console.log(theme.colors.warning('⚠ No configuration options provided'));
      console.log();
      console.log(theme.colors.muted('Available options:'));
      console.log(theme.colors.muted('  --env KEY=VALUE    Set environment variable'));
      console.log(theme.colors.muted('  --args ARG1,ARG2   Set command arguments'));
      console.log(theme.colors.muted('  --timeout MS       Set timeout (milliseconds)'));
      console.log(theme.colors.muted('  --max-retries N    Set max retry attempts'));
      console.log();
      return;
    }

    // Send configuration to server
    const response = await client.post(`/mcp/servers/${serverName}/configure`, config);

    if (response.success) {
      console.log(theme.colors.success('✓ Configuration updated'));
      console.log();

      if (config.env) {
        console.log(theme.colors.secondary('Environment variables:'));
        Object.entries(config.env).forEach(([key, value]) => {
          console.log(theme.colors.muted(`  ${key}=${value}`));
        });
        console.log();
      }

      if (config.args) {
        console.log(theme.colors.secondary('Arguments:'));
        console.log(theme.colors.muted(`  ${config.args.join(' ')}`));
        console.log();
      }

      if (config.timeout) {
        console.log(theme.colors.secondary(`Timeout: ${config.timeout}ms`));
      }

      if (config.maxRetries !== undefined) {
        console.log(theme.colors.secondary(`Max retries: ${config.maxRetries}`));
      }

      console.log();
      console.log(theme.colors.muted('Changes will apply on next server restart'));
      console.log();

    } else {
      console.log(theme.colors.error('✗ Configuration failed'));
      if (response.message) {
        console.log(theme.colors.muted(response.message));
      }
      console.log();
      process.exit(1);
    }

  } catch (error: any) {
    if (error.message.includes('404') || error.message.includes('Not Found')) {
      console.error(theme.colors.error(`✗ Server not found: ${serverName}`));
      console.log(theme.colors.muted('\nAvailable servers:'));
      console.log(theme.colors.muted('  cortex mcp list'));
    } else {
      console.error(theme.colors.error(`✗ Error: ${error.message}`));
    }
    console.log();
    process.exit(1);
  }
}
