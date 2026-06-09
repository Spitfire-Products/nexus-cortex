/**
 * Start the Cortex server if not already running
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ServerStartOptions {
  serverUrl?: string;
  port?: number;
  detach?: boolean;
}

/**
 * Start the Cortex server
 * Checks if server is already running before starting
 */
export async function serverStart(
  options: ServerStartOptions = {}
): Promise<void> {
  const theme = ThemeManager.getTheme();
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);

  try {
    // Check if server is already running
    console.log(theme.colors.muted('Checking server status...'));

    try {
      await client.health();
      console.log(theme.colors.success('✓ Server is already running'));
      console.log(theme.colors.muted(` URL: ${serverUrl}`));
      return;
    } catch (error) {
      // Server not running, continue to start it
      console.log(theme.colors.muted('Server not running, starting...'));
    }

    // Determine server location
    // This assumes the server is in a sibling directory to the CLI
    // const serverPath = process.env.CORTEX_SERVER_PATH || '../../../server';

    console.log();
    console.log(theme.colors.warning('⚠ Server auto-start not yet fully implemented'));
    console.log();
    console.log(theme.colors.muted('To start the server manually:'));
    console.log(theme.colors.secondary(' cd nexus-cortex/packages/server'));
    console.log(theme.colors.secondary(' npm start'));
    console.log();
    console.log(theme.colors.muted('Or set CORTEX_SERVER_PATH environment variable'));
    console.log();

    // Future implementation would spawn the server process
    // const port = options.port || 4000;
    // const serverProcess = spawn('npm', ['start'], {
    //   cwd: serverPath,
    //   detached: options.detach,
    //   stdio: options.detach ? 'ignore' : 'inherit',
    //   env: { ...process.env, PORT: String(port) }
    // });

    // if (options.detach) {
    //   serverProcess.unref();
    //   console.log(theme.colors.success(`✓ Server started in background (PID: ${serverProcess.pid})`));
    // }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
