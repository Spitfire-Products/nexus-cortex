/**
 * Templates List Command
 * List available artifact templates
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface TemplatesListOptions {
  serverUrl?: string;
  json?: boolean;
  type?: string;
}

/**
 * List available templates
 */
export async function templatesList(options: TemplatesListOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Build query parameters
    const params: any = {};
    if (options.type) params.type = options.type.toLowerCase();

    const queryString = Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';

    // Get templates
    const response = await client.get(`/templates/list${queryString}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📋 Available Templates\n'));

    if (!response.templates || response.templates.length === 0) {
      console.log(theme.colors.muted('No templates found.'));
      console.log();
      return;
    }

    // Group templates by type
    const byType: any = {};
    for (const template of response.templates) {
      const type = template.type || 'other';
      if (!byType[type]) byType[type] = [];
      byType[type].push(template);
    }

    // Display templates by type
    for (const [type, templates] of Object.entries(byType)) {
      console.log(theme.colors.secondary(`${type.toUpperCase()}:`));

      for (const template of templates as any[]) {
        console.log(`  ${theme.colors.highlight(template.name)}`);

        if (template.description) {
          console.log(`    ${theme.colors.muted(template.description)}`);
        }

        if (template.framework) {
          console.log(`    Framework: ${theme.colors.secondary(template.framework)}`);
        }

        if (template.language) {
          console.log(`    Language: ${theme.colors.muted(template.language)}`);
        }

        console.log();
      }
    }

    // Summary
    console.log(theme.colors.secondary('Summary:'));
    console.log(`  Total templates: ${theme.colors.highlight(response.templates.length.toString())}`);
    console.log();

    console.log(theme.colors.muted('Create artifact from template:'));
    console.log(theme.colors.muted('  cortex templates create <template-name> <artifact-name>'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
