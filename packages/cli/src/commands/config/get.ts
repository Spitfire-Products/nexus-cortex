/**
 * Get configuration value(s)
 *
 * Unified config: reads from .env via SettingsLoader.
 * Shows current values grouped by category.
 */
import { SettingsLoader, SETTINGS_METADATA, type SettingMetadata } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from './utils.js';

export interface ConfigGetOptions {
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

const CATEGORY_ORDER = [
  'models', 'system', 'runtime', 'loop_control', 'context',
  'mentorship', 'server_side_tools', 'model_router', 'training',
  'session', 'agent_workspace', 'api_keys',
];

function getCurrentValue(key: string, loader: SettingsLoader): string {
  const fromEnv = process.env[key];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return loader.get(key as any) || '';
}

function formatDisplayValue(setting: SettingMetadata, value: string): string {
  if (setting.secret && value) {
    return value.length > 8
      ? value.substring(0, 4) + '...' + value.substring(value.length - 4)
      : '***configured***';
  }
  return value || '(not set)';
}

/**
 * Get configuration value(s)
 * If key provided, shows single value; otherwise shows all config grouped by category
 */
export async function configGet(
  key?: string,
  options: ConfigGetOptions = {}
): Promise<void> {
  const theme = ThemeManager.getTheme();
  const projectPath = findProjectRoot();
  const loader = new SettingsLoader(projectPath);

  try {
    if (options.json) {
      if (key) {
        const value = getCurrentValue(key, loader);
        console.log(JSON.stringify({ [key]: value }, null, 2));
      } else {
        const env = loader.getEnvironment();
        console.log(JSON.stringify(env, null, 2));
      }
      return;
    }

    if (key) {
      const value = getCurrentValue(key, loader);
      const meta = SETTINGS_METADATA.find(s => s.key === key);
      if (!meta && !value) {
        console.error(theme.colors.error(`Unknown config key: ${key}`));
        console.log(theme.colors.muted('\nUse "cortex config list" to see all keys'));
        process.exit(1);
      }
      const display = meta ? formatDisplayValue(meta, value) : value;
      console.log(theme.colors.highlight(`${key}:`), theme.colors.secondary(display));
      return;
    }

    console.log(theme.colors.primary('\nConfiguration (.env):'));
    console.log();

    for (const cat of CATEGORY_ORDER) {
      const settings = SETTINGS_METADATA.filter(s => s.category === cat);
      if (settings.length === 0) continue;

      console.log(theme.colors.highlight(` ${CATEGORY_LABELS[cat] || cat}`));
      for (const s of settings) {
        const value = getCurrentValue(s.key, loader);
        const display = formatDisplayValue(s, value);
        const padded = s.displayName.padEnd(30);
        console.log(` ${theme.colors.muted(padded)} ${theme.colors.secondary(display)}`);
      }
      console.log();
    }

    console.log(theme.colors.muted(`Config source: ${projectPath}/.env`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
