/**
 * Set configuration value
 *
 * Unified config: writes to .env via SettingsLoader.
 * Validates against SettingsSchema metadata.
 */
import {
  SettingsLoader,
  SETTINGS_METADATA,
  validateSetting,
  isLiveToggleable,
  type EnvironmentVariables,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from './utils.js';

/**
 * Set configuration value
 * Validates the key and value before saving to .env
 */
export async function configSet(
  key: string,
  value: string
): Promise<void> {
  const theme = ThemeManager.getTheme();

  try {
    const meta = SETTINGS_METADATA.find(s => s.key === key);
    if (!meta) {
      const allKeys = SETTINGS_METADATA.map(s => s.key);
      const close = allKeys.filter(k => k.toLowerCase().includes(key.toLowerCase()));
      console.error(theme.colors.error(`Unknown config key: ${key}`));
      if (close.length > 0) {
        console.log(theme.colors.muted(`\nDid you mean: ${close.slice(0, 5).join(', ')}?`));
      }
      console.log(theme.colors.muted('\nUse "cortex config list" to see all keys'));
      process.exit(1);
      return; // guard: process.exit is mockable in tests — never fall through to a write
    }

    const validation = validateSetting(key as keyof EnvironmentVariables, value);
    if (validation !== true) {
      console.error(theme.colors.error(`Invalid value for ${key}: ${validation}`));
      if (meta.type === 'choice' && meta.choices) {
        console.log(theme.colors.muted(`Valid values: ${meta.choices.join(', ')}`));
      }
      process.exit(1);
      return; // guard: do not write an invalid value if exit is mocked
    }

    const projectPath = findProjectRoot();
    const loader = new SettingsLoader(projectPath);
    const result = loader.set(key as keyof EnvironmentVariables, value);

    if (!result.success) {
      console.error(theme.colors.error(`Failed to set ${key}: ${result.error}`));
      process.exit(1);
      return;
    }

    process.env[key] = value;

    const label = isLiveToggleable(key) ? '(live)' : '(restart required)';
    console.log(theme.colors.success(`[OK] ${key} updated ${label}`));
    if (result.previousValue !== undefined && result.previousValue !== value) {
      console.log(theme.colors.muted(` was: ${result.previousValue}`));
    }
    console.log(theme.colors.highlight(` now: ${value}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
