/**
 * Artifact Status Command
 * Show detailed artifact status
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show artifact status
 */
export async function artifactStatus(
  id?: string,
  options: ArtifactStatusOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Artifact ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex artifact status <id>'));
      console.log(theme.colors.muted('\nExample:'));
      console.log(theme.colors.muted(' cortex artifact status dashboard-123'));
      process.exit(1);
      return;
    }

    // Get artifact status
    const response = await client.get(`/artifact/status/${id}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n Artifact Status: ${id}\n`));

    // Basic info
    console.log(theme.colors.secondary('Basic Information:'));
    if (response.name) {
      console.log(` Name: ${theme.colors.highlight(response.name)}`);
    }
    if (response.type) {
      console.log(` Type: ${theme.colors.highlight(response.type)}`);
    }
    if (response.mode) {
      console.log(` Mode: ${theme.colors.highlight(response.mode)}`);
    }
    if (response.status) {
      const statusColor = response.status === 'running' ? theme.colors.success : theme.colors.muted;
      console.log(` Status: ${statusColor(response.status)}`);
    }
    console.log();

    // Runtime info
    if (response.port || response.pid || response.uptime) {
      console.log(theme.colors.secondary('Runtime Information:'));
      if (response.port) {
        console.log(` Port: ${theme.colors.highlight(response.port.toString())}`);
      }
      if (response.url) {
        console.log(` URL: ${theme.colors.highlight(response.url)}`);
      }
      if (response.pid) {
        console.log(` PID: ${theme.colors.muted(response.pid.toString())}`);
      }
      if (response.uptime) {
        console.log(` Uptime: ${theme.colors.muted(response.uptime)}`);
      }
      console.log();
    }

    // Resource usage
    if (response.resources) {
      console.log(theme.colors.secondary('Resource Usage:'));
      if (response.resources.cpu) {
        console.log(` CPU: ${theme.colors.highlight(response.resources.cpu)}%`);
      }
      if (response.resources.memory) {
        console.log(` Memory: ${theme.colors.highlight(response.resources.memory)}`);
      }
      if (response.resources.disk) {
        console.log(` Disk: ${theme.colors.muted(response.resources.disk)}`);
      }
      console.log();
    }

    // Environment
    if (response.env) {
      console.log(theme.colors.secondary('Environment:'));
      console.log(` Type: ${theme.colors.muted(response.env)}`);
      console.log();
    }

    console.log(theme.colors.muted('Manage artifact with:'));
    console.log(theme.colors.muted(' cortex artifact inspect <id>   - Inspect state'));
    console.log(theme.colors.muted(' cortex artifact modify <id>    - Edit code'));
    console.log(theme.colors.muted(' cortex artifact view <id>      - Open in browser'));
    console.log(theme.colors.muted(' cortex artifact stop <id>      - Stop artifact'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
