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
  // 2026-11-14 (m2: a server started 11-05 survived three updates and kept serving the old harness): stop a running server so the next
  // call starts the NEW one. The CLI's stale-server check (4.137.1) also catches it; this makes the update itself leave nothing old behind.
  const base = process.env.CORTEX_URL || `http://localhost:${process.env.PORT || '4000'}`;
  try {
    const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    if (h.ok) {
      await fetch(`${base}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      console.log(theme.colors.muted(`Stopped the running server on ${base} — the next cortex call starts the updated one.`));
    }
  } catch { /* no server running */ }
  console.log(theme.colors.success('\n[OK] Updated. Run "cortex --version" to confirm.'));
}
