/**
 * Artifact Inspect Command
 * Visual inspection of artifact state (screenshots, DOM, console, network)
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactInspectOptions {
  serverUrl?: string;
  json?: boolean;
  screenshot?: boolean;
  dom?: boolean;
  console?: boolean;
  network?: boolean;
  output?: string;
}

/**
 * Inspect artifact state
 */
export async function artifactInspect(
  id?: string,
  options: ArtifactInspectOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Artifact ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex artifact inspect <id> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --screenshot       Capture screenshot'));
      console.log(theme.colors.muted('  --dom              Inspect DOM'));
      console.log(theme.colors.muted('  --console          View console logs'));
      console.log(theme.colors.muted('  --network          Check network requests'));
      console.log(theme.colors.muted('  --output <path>    Save screenshot to file'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex artifact inspect dashboard-123 --screenshot'));
      console.log(theme.colors.muted('  cortex artifact inspect dashboard-123 --dom'));
      process.exit(1);
      return;
    }

    // Build request payload
    const payload: any = { id };
    if (options.screenshot) payload.screenshot = true;
    if (options.dom) payload.dom = true;
    if (options.console) payload.console = true;
    if (options.network) payload.network = true;
    if (options.output) payload.output = options.output;

    // Inspect artifact
    const response = await client.post('/artifact/inspect', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n🔍 Artifact Inspection: ${id}\n`));

    // Screenshot
    if (response.screenshot) {
      console.log(theme.colors.secondary('Screenshot:'));
      if (response.screenshot.path) {
        console.log(`  Saved to: ${theme.colors.highlight(response.screenshot.path)}`);
      }
      if (response.screenshot.size) {
        const sizeKB = (response.screenshot.size / 1024).toFixed(2);
        console.log(`  Size: ${theme.colors.muted(sizeKB + ' KB')}`);
      }
      if (response.screenshot.base64) {
        console.log(`  Data: ${theme.colors.muted('Base64 PNG available')}`);
        console.log(theme.colors.muted('  🎯 AI can now see the terminal state visually!'));
      }
      console.log();
    }

    // DOM
    if (response.dom) {
      console.log(theme.colors.secondary('DOM Structure:'));
      if (response.dom.elements) {
        console.log(`  Elements: ${theme.colors.highlight(response.dom.elements.toString())}`);
      }
      if (response.dom.tree) {
        console.log(theme.colors.muted('  Tree:'));
        console.log(theme.colors.muted('    ' + response.dom.tree.split('\n').join('\n    ')));
      }
      console.log();
    }

    // Console logs
    if (response.console) {
      console.log(theme.colors.secondary('Console Logs:'));
      if (response.console.logs && response.console.logs.length > 0) {
        for (const log of response.console.logs) {
          const levelColor = log.level === 'error' ? theme.colors.error :
                            log.level === 'warn' ? theme.colors.warning :
                            theme.colors.muted;
          console.log(`  ${levelColor(`[${log.level}]`)} ${log.message}`);
        }
      } else {
        console.log(theme.colors.muted('  No console logs'));
      }
      console.log();
    }

    // Network
    if (response.network) {
      console.log(theme.colors.secondary('Network Requests:'));
      if (response.network.requests && response.network.requests.length > 0) {
        for (const req of response.network.requests) {
          console.log(`  ${theme.colors.highlight(req.method)} ${req.url}`);
          if (req.status) {
            const statusColor = req.status >= 200 && req.status < 300
              ? theme.colors.success
              : theme.colors.error;
            console.log(`    Status: ${statusColor(req.status.toString())}`);
          }
        }
      } else {
        console.log(theme.colors.muted('  No network requests'));
      }
      console.log();
    }

    console.log(theme.colors.muted('Other inspection commands:'));
    console.log(theme.colors.muted('  cortex sandbox screenshot <id>  - Capture screenshot'));
    console.log(theme.colors.muted('  cortex sandbox logs <id>        - View logs'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
