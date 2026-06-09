/**
 * Reset configuration to benchmark-proven optimal defaults
 *
 * Backs up current .env, then writes DEFAULT_SETTINGS while preserving API keys.
 */
import {
  SettingsLoader,
  SettingsWriter,
  DEFAULT_SETTINGS,
  SETTINGS_METADATA,
  type EnvironmentVariables,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from './utils.js';

const API_KEY_FIELDS = SETTINGS_METADATA
  .filter(s => s.category === 'api_keys')
  .map(s => s.key);

export interface ConfigResetOptions {
  force?: boolean;
  includeKeys?: boolean;
}

export async function configReset(options: ConfigResetOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();
  const projectPath = findProjectRoot();
  const writer = new SettingsWriter(projectPath);
  const loader = new SettingsLoader(projectPath);

  try {
    const currentEnv = loader.getEnvironment();

    const preserved: Partial<EnvironmentVariables> = {};
    if (!options.includeKeys) {
      for (const key of API_KEY_FIELDS) {
        const val = currentEnv[key as keyof EnvironmentVariables];
        if (val) {
          preserved[key as keyof EnvironmentVariables] = val;
        }
      }
    }

    const backupPath = writer.backup();
    if (backupPath) {
      console.log(theme.colors.muted(` Backup: ${backupPath}`));
    }

    const resetEnv: Partial<EnvironmentVariables> = {
      ...DEFAULT_SETTINGS,
      ...preserved,
    };

    writer.write(resetEnv);

    for (const [key, val] of Object.entries(resetEnv)) {
      process.env[key] = val as string;
    }

    const preservedCount = Object.keys(preserved).length;
    const totalSettings = SETTINGS_METADATA.length;

    console.log(theme.colors.success(`[OK] Configuration reset to optimal defaults`));
    console.log(theme.colors.muted(` ${totalSettings} settings written`));
    if (preservedCount > 0) {
      console.log(theme.colors.muted(` ${preservedCount} API keys preserved`));
    }
    console.log();

    const highlights = [
      'DEFAULT_MODEL_ID', 'HELPER_MODEL_ID', 'CONTEXT_BUDGET_STRATEGY',
      'TOOL_TIMEOUT_MS', 'MODEL_ROUTER_EXPLORATION', 'MODEL_ROUTER_EXCLUDE',
      'MCP_AUTO_INJECT', 'ENABLE_SERVER_SIDE_TOOLS',
    ];
    for (const key of highlights) {
      const val = resetEnv[key as keyof EnvironmentVariables] || DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
      if (val) {
        const meta = SETTINGS_METADATA.find(s => s.key === key);
        const name = meta?.displayName || key;
        console.log(` ${theme.colors.highlight(name.padEnd(30))} ${theme.colors.secondary(val)}`);
      }
    }
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
