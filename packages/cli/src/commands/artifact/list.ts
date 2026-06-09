/**
 * Artifact List Command
 * Lists all artifacts with optional filtering
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactListOptions {
  serverUrl?: string;
  json?: boolean;
  status?: string;
  type?: string;
}

/**
 * List all artifacts
 */
export async function artifactList(options: ArtifactListOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Build query parameters
    const params: any = {};
    if (options.status) params.status = options.status.toLowerCase();
    if (options.type) params.type = options.type.toLowerCase();

    // Fetch artifacts
    const queryString = Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';
    const response = await client.get(`/artifact/list${queryString}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n Artifacts\n'));

    if (!response.artifacts || response.artifacts.length === 0) {
      console.log(theme.colors.muted('No artifacts found.'));
      console.log();
      console.log(theme.colors.muted('Create one with:'));
      console.log(theme.colors.muted(' cortex artifact create <name> --type <type>'));
      console.log();
      return;
    }

    // Display artifacts
    for (const artifact of response.artifacts) {
      const statusIcon = artifact.status === 'running' ? '●' : '○';
      const statusColor = artifact.status === 'running' ? theme.colors.success : theme.colors.muted;

      console.log(`${statusColor(statusIcon)} ${theme.colors.highlight(artifact.name || artifact.id)}`);
      console.log(` ID: ${theme.colors.muted(artifact.id)}`);

      if (artifact.type) {
        console.log(` Type: ${theme.colors.secondary(artifact.type)}`);
      }

      if (artifact.mode) {
        console.log(` Mode: ${theme.colors.secondary(artifact.mode)}`);
      }

      if (artifact.port) {
        console.log(` Port: ${theme.colors.highlight(artifact.port.toString())}`);
      }

      if (artifact.url) {
        console.log(` URL: ${theme.colors.highlight(artifact.url)}`);
      }

      if (artifact.status) {
        console.log(` Status: ${statusColor(artifact.status)}`);
      }

      if (artifact.created) {
        console.log(` Created: ${theme.colors.muted(artifact.created)}`);
      }

      console.log();
    }

    // Summary
    const runningCount = response.artifacts.filter((a: any) => a.status === 'running').length;
    const stoppedCount = response.artifacts.length - runningCount;

    console.log(theme.colors.secondary('Summary:'));
    console.log(` Total: ${theme.colors.highlight(response.artifacts.length.toString())}`);
    console.log(` Running: ${theme.colors.success(runningCount.toString())}`);
    console.log(` Stopped: ${theme.colors.muted(stoppedCount.toString())}`);
    console.log();

    console.log(theme.colors.muted('Manage artifacts with:'));
    console.log(theme.colors.muted(' cortex artifact inspect <id>   - Inspect artifact'));
    console.log(theme.colors.muted(' cortex artifact view <id>      - Open in browser'));
    console.log(theme.colors.muted(' cortex artifact stop <id>      - Stop artifact'));
    console.log(theme.colors.muted(' cortex artifact dashboard      - View all'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
