/**
 * Initialize the global user config file (~/.cortex/.env).
 *
 * Creates a KEYS-ONLY .env in the user's home — the canonical, findable place for your
 * provider keys and any deliberate overrides. Harness DEFAULTS are NOT written here: they
 * ship in the package (.env.defaults) and are read live, so this file stays sparse and a
 * package upgrade brings new defaults with nothing to regenerate and no keys to re-enter.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import {
  keysOnlyStub,
  writeEnvSetting,
  parseEnvFile,
  SETTINGS_METADATA,
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

    if (!exists) {
      writeFileSync(envPath, keysOnlyStub());
      console.log(theme.colors.success(`[OK] created ${envPath}`));
    } else if (options.force) {
      // Non-destructive refresh: add any provider-key slots that are missing (e.g. a new
      // provider shipped since you first set up), preserving every value you've set.
      const present = parseEnvFile(readFileSync(envPath, 'utf-8'));
      const added: string[] = [];
      for (const m of SETTINGS_METADATA.filter(s => s.secret)) {
        if (present[m.key] === undefined) { writeEnvSetting(dir, m.key, ''); added.push(m.key); }
      }
      console.log(theme.colors.success(`[OK] ${envPath} — ${added.length} new key slot${added.length === 1 ? '' : 's'} added, values preserved`));
    } else {
      console.log(theme.colors.warning(`[skip] config already exists: ${envPath}`));
      console.log(theme.colors.muted('  Edit it, or run "cortex config set KEY VALUE". Harness defaults are read-live (no template to refresh).'));
      console.log(theme.colors.muted('  "cortex config init --force" adds any missing provider-key slots.'));
      return;
    }

    console.log();
    console.log(theme.colors.muted('  Set your keys one of two ways:'));
    console.log(theme.colors.highlight(`    • open ${envPath} and edit it`));
    console.log(theme.colors.highlight('    • or run: cortex config set ANTHROPIC_API_KEY sk-ant-...'));
    console.log(theme.colors.muted('  Everything else uses the shipped defaults; override a lever with "cortex config set".'));
    console.log();
  } catch (error: any) {
    console.error(theme.colors.error(`Failed to initialize config: ${error.message}`));
    process.exit(1);
  }
}
