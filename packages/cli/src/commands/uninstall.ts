/**
 * `cortex uninstall` — remove the global install.
 *
 * By default your config + API keys at ~/.cortex are LEFT in place (so you don't lose
 * keys by accident); --purge removes them too. Interactive runs confirm first;
 * non-interactive runs require --yes so a stray invocation can't wipe an install.
 */
import { spawnSync } from 'child_process';
import { rmSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { getGlobalConfigDir } from '@nexus-cortex/core';
import { ThemeManager } from '../themes/ThemeManager.js';

const PKG_NAME = 'nexus-cortex';

function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function uninstallCli(options: { purge?: boolean; yes?: boolean } = {}): Promise<void> {
  const theme = ThemeManager.getTheme();
  const dir = getGlobalConfigDir();

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.error(theme.colors.error('Refusing to uninstall non-interactively without --yes.'));
      process.exit(1);
      return;
    }
    const ok = await askYesNo(
      theme.colors.warning(`Uninstall nexus-cortex globally${options.purge ? ` and delete ${dir}` : ''}? [y/N] `),
    );
    if (!ok) {
      console.log(theme.colors.muted('Cancelled.'));
      return;
    }
  }

  console.log(theme.colors.highlight('Uninstalling nexus-cortex…'));
  console.log();
  const res = spawnSync('npm', ['uninstall', '-g', PKG_NAME], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(theme.colors.error('\nUninstall failed — see the npm output above.'));
    console.error(theme.colors.muted('If it is a permissions error: sudo npm uninstall -g nexus-cortex'));
    process.exit(res.status || 1);
    return;
  }

  if (options.purge) {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
        console.log(theme.colors.muted(`Removed ${dir}`));
      }
      console.log(theme.colors.success('\n[OK] Uninstalled and purged.'));
    } catch (e: any) {
      console.error(theme.colors.error(`Uninstalled, but could not remove ${dir}: ${e.message}`));
    }
  } else {
    console.log(theme.colors.success('\n[OK] Uninstalled.'));
    console.log(theme.colors.muted(`Your config + API keys remain at ${dir} — to remove them too: rm -rf ${dir}`));
  }
}
