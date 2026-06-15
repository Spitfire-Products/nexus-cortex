/**
 * Initialize the global user config file (~/.cortex/.env).
 *
 * Creates a schema-templated .env in the user's home directory — the canonical,
 * findable, editable config location — so a globally-installed CLI can be configured
 * by opening one file, regardless of where npm placed the binary. With --force it
 * regenerates the template while preserving any values you've already set.
 */
import { existsSync, mkdirSync } from 'fs';
import {
  createDefaultEnvFile,
  updateEnvFile,
  getGlobalConfigDir,
  getGlobalEnvPath,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';

export async function configInit(options: { force?: boolean } = {}): Promise<void> {
  const theme = ThemeManager.getTheme();
  const dir = getGlobalConfigDir();
  const envPath = getGlobalEnvPath();

  try {
    mkdirSync(dir, { recursive: true });
    const exists = existsSync(envPath);

    if (exists && !options.force) {
      console.log(theme.colors.warning(`[skip] config already exists: ${envPath}`));
      console.log(theme.colors.muted('  Open it to edit your settings, or run "cortex config set KEY VALUE".'));
      console.log(theme.colors.muted('  Use "cortex config init --force" to refresh the template (your values are preserved).'));
      return;
    }

    if (exists) {
      // Refresh template/comments without discarding existing values.
      updateEnvFile(dir, {});
    } else {
      createDefaultEnvFile(dir);
    }

    console.log(theme.colors.success(`[OK] ${exists ? 'refreshed' : 'created'} ${envPath}`));
    console.log();
    console.log(theme.colors.muted('  Set your keys one of two ways:'));
    console.log(theme.colors.highlight(`    • open ${envPath} and edit it`));
    console.log(theme.colors.highlight('    • or run: cortex config set ANTHROPIC_API_KEY sk-ant-...'));
    console.log();
  } catch (error: any) {
    console.error(theme.colors.error(`Failed to initialize config: ${error.message}`));
    process.exit(1);
  }
}
