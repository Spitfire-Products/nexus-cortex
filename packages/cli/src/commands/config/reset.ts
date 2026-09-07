/**
 * Reset configuration to the shipped defaults.
 *
 * In the read-live model, "reset" REMOVES the user's lever override lines from the global
 * ~/.cortex/.env so every lever falls back to the shipped `.env.defaults` (and picks up
 * future updates). API keys are preserved unless --include-keys is given. Backs up first.
 */
import {
  SettingsLoader,
  SettingsWriter,
  removeGlobalSetting,
  getGlobalConfigDir,
  SETTINGS_METADATA,
  type EnvironmentVariables,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';

const API_KEY_FIELDS = SETTINGS_METADATA
  .filter(s => s.category === 'api_keys')
  .map(s => s.key);

export interface ConfigResetOptions {
  force?: boolean;
  includeKeys?: boolean;
}

export async function configReset(options: ConfigResetOptions = {}): Promise<void> {
  const theme = ThemeManager.getTheme();
  const globalDir = getGlobalConfigDir();
  const loader = new SettingsLoader(globalDir);

  try {
    const backupPath = new SettingsWriter(globalDir).backup();
    if (backupPath) {
      console.log(theme.colors.muted(` Backup: ${backupPath}`));
    }

    // Remove every lever override (preserve API keys) so they fall back to shipped defaults.
    const results = loader.resetAllToDefaults();
    let removed = Object.keys(results).length;

    // --include-keys: also clear the stored API keys.
    if (options.includeKeys) {
      for (const key of API_KEY_FIELDS) {
        const r = removeGlobalSetting(key as keyof EnvironmentVariables);
        if (r.success && r.previousValue) removed++;
      }
    }

    console.log(theme.colors.success(`[OK] Reset — ${removed} override${removed === 1 ? '' : 's'} removed; levers now flow from the shipped defaults`));
    if (!options.includeKeys) {
      console.log(theme.colors.muted(` API keys preserved`));
    }
    console.log(theme.colors.muted(` Restart the server for changes to take effect.`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
