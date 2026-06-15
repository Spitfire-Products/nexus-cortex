/**
 * `cortex-cli update` — update the global install to the latest published release,
 * with visible npm output. Thin wrapper over the canonical lifecycle update service
 * (the same code the startup check uses), so there's one update path, not per-bin flags.
 */
import { getCurrentVersion, runUpdate } from '../lifecycle/updateCheck.js';
import { ThemeManager } from '../themes/ThemeManager.js';

export async function updateCli(): Promise<void> {
  const theme = ThemeManager.getTheme();
  const current = getCurrentVersion() || 'unknown';
  console.log(theme.colors.highlight(`Updating nexus-cortex (current: ${current})…`));
  console.log();

  if (runUpdate()) {
    console.log(theme.colors.success('\n[OK] Updated. Run "cortex-cli --version" to confirm.'));
    return;
  }

  console.error(theme.colors.error('\nUpdate failed — see the npm output above.'));
  console.error(theme.colors.muted('If it is a permissions error: sudo npm install -g nexus-cortex@latest'));
  process.exit(1);
}
