/**
 * `cortex update` — update the global install to the latest published release,
 * with visible npm output. Thin wrapper over the canonical lifecycle update service
 * (the same code the startup check uses), so there's one update path, not per-bin flags.
 */
import { getCurrentVersion, runUpdate } from '../lifecycle/updateCheck.js';
import { OPTIONAL_KINDS, OPTIONAL_PACKAGES, installedOptionalPackages, runCortex, setupArgs } from '../lifecycle/optionalPackages.js';
import { ThemeManager } from '../themes/ThemeManager.js';

export async function updateCli(opts: { browser?: boolean; desktop?: boolean } = {}): Promise<void> {
  const theme = ThemeManager.getTheme();
  const current = getCurrentVersion() || 'unknown';
  // 2026-11-13: `cortex update` keeps every installed optional package current; --browser / --desktop add them.
  const installed = installedOptionalPackages();
  const requested = OPTIONAL_KINDS.filter((k) => (k === 'browser' && opts.browser) || (k === 'desktop' && opts.desktop));
  const kinds = [...new Set([...installed, ...requested])];
  const names = kinds.map((k) => OPTIONAL_PACKAGES[k]);
  console.log(theme.colors.highlight(`Updating nexus-cortex (current: ${current})${names.length ? ` + ${names.join(', ')}` : ''}…`));
  console.log();

  if (!runUpdate(names)) {
    console.error(theme.colors.error('\nUpdate failed — see the npm output above.'));
    console.error(theme.colors.muted(`If it is a permissions error: sudo npm install -g nexus-cortex@latest${names.map((n) => ` ${n}@latest`).join('')}`));
    process.exit(1);
  }

  // Setup: a newly requested package is made usable now; an installed browser re-runs its (idempotent) runtime installer so new
  // pieces a release adds arrive too. The desktop is never re-enabled behind the user's back — enabling stays their choice.
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;
  for (const k of kinds) {
    if (k === 'desktop' && !requested.includes('desktop')) continue;
    const args = setupArgs(k, interactive);
    if (!args) { console.log(theme.colors.muted(`\n${OPTIONAL_PACKAGES[k]} installed. Turn it on in a terminal: cortex desktop enable --real`)); continue; }
    console.log(theme.colors.highlight(`\nSetting up ${OPTIONAL_PACKAGES[k]}: cortex ${args.join(' ')}`));
    if (runCortex(args) !== 0) console.error(theme.colors.error(`Setup of ${OPTIONAL_PACKAGES[k]} did not finish — run: cortex ${args.join(' ')}`));
  }
  console.log(theme.colors.success('\n[OK] Updated. Run "cortex --version" to confirm.'));
}
