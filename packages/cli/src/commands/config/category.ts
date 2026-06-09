/**
 * Show configuration category settings
 */
import { SettingsLoader, SETTINGS_METADATA } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from './utils.js';

export interface ConfigCategoryOptions {
  json?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  api_keys: 'API Keys',
  models: 'Models',
  system: 'System',
  mentorship: 'Mentorship',
  context: 'Context Management',
  session: 'Session',
  loop_control: 'Loop Control',
  server_side_tools: 'Tools & Execution',
  model_router: 'Model Router',
  agent_workspace: 'Agent Workspace',
  training: 'Training & Audit',
  runtime: 'Runtime',
};

function getCurrentValue(key: string, loader: SettingsLoader): string {
  const fromEnv = process.env[key];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return loader.get(key as any) || '';
}

/**
 * Show configuration category settings with current values
 */
export async function configCategory(
  categoryName: string,
  options: ConfigCategoryOptions = {}
): Promise<void> {
  const theme = ThemeManager.getTheme();

  try {
    const categoryKey = categoryName.toLowerCase().replace(/\s+/g, '_');
    const settings = SETTINGS_METADATA.filter(s => s.category === categoryKey);

    if (settings.length === 0) {
      const categories = [...new Set(SETTINGS_METADATA.map(s => s.category))];
      console.error(theme.colors.error(`Unknown category: ${categoryName}`));
      console.log(theme.colors.muted('\nAvailable categories:'));
      for (const key of categories) {
        console.log(theme.colors.muted(` ${key} — ${CATEGORY_LABELS[key] || key}`));
      }
      process.exit(1);
    }

    const projectPath = findProjectRoot();
    const loader = new SettingsLoader(projectPath);

    if (options.json) {
      const result: Record<string, string> = {};
      for (const s of settings) {
        result[s.key] = getCurrentValue(s.key, loader);
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const label = CATEGORY_LABELS[categoryKey] || categoryKey;
    console.log(theme.colors.primary(`\n${label}:`));
    console.log();

    for (const s of settings) {
      const value = getCurrentValue(s.key, loader);
      let display: string;
      if (s.secret && value) {
        display = value.length > 8
          ? value.substring(0, 4) + '...' + value.substring(value.length - 4)
          : '***configured***';
      } else {
        display = value || '(not set)';
      }
      const padded = s.displayName.padEnd(30);
      console.log(` ${theme.colors.highlight(padded)} ${theme.colors.secondary(display)}`);
      if (s.description) {
        console.log(` ${''.padEnd(30)} ${theme.colors.muted(s.description)}`);
      }
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
