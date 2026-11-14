/**
 * `cortex desktop status | enable [--virtual|--real] | disable` — the DESKTOP surface (operator 2026-11-12: separate from the browser).
 * Policy: OFF by default. `enable --virtual` = a private X display (Linux/containers; never the user's screen). `enable --real` = the user's
 * OWN screen — only interactively, with a typed confirmation; never from --yes or a script. The tool itself lives in the optional, separately
 * licensed @nexus-cortex/desktop package (AGPL-3.0-only OR commercial); core never imports it, this command only checks and switches it.
 */
import { execFileSync } from 'child_process';
import inquirer from 'inquirer';
import { SettingsLoader, getGlobalConfigDir, resolveDesktop } from '@nexus-cortex/core';
import { OPTIONAL_PACKAGES, npmInstallGlobal, runCortex, setupArgs } from '../../lifecycle/optionalPackages.js';

const tty = () => !!process.stdin.isTTY && !!process.stdout.isTTY;
const onPath = (bin: string) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
const NOT_INSTALLED = 'The desktop package is not installed. Install it with: cortex desktop install';

function setDesktop(mode: 'virtual' | 'real' | ''): void {
  new SettingsLoader(getGlobalConfigDir()).setMultiple({ NEXUS_DESKTOP: mode } as never);
  process.env.NEXUS_DESKTOP = mode;
}

/** 2026-11-14 (m2 report): this row used to be hard-coded ok. Read the real state through osascript/JXA (the same calls the desktop tool
 *  makes): Accessibility = AXIsProcessTrusted; Screen Recording = CGPreflightScreenCaptureAccess (needs ObjC.bindFunction — without it the
 *  function is never defined and the old check always said granted). Unknown → an optional row with the fix. Permissions belong to the
 *  terminal app this runs in. */
function macPermissionRows(): Array<{ item: string; ok: boolean; fix?: string; optional?: boolean }> {
  const fix = 'System Settings → Privacy & Security → grant it to your terminal app (Terminal / iTerm2), then restart that app';
  let ax = -1, sr = -1;
  try {
    const js = "ObjC.import('ApplicationServices'); var a = $.AXIsProcessTrusted() ? 1 : 0; var s = 2; try { ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]); s = $.CGPreflightScreenCaptureAccess() ? 1 : 0; } catch (e) { s = 2; } a + ' ' + s;";
    const out = execFileSync('osascript', ['-l', 'JavaScript', '-e', js], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/).map(Number);
    ax = out[0] ?? -1; sr = out[1] ?? -1;
  } catch { /* osascript unavailable or refused: report unknown */ }
  const row = (item: string, v: number) => v === 1 ? { item, ok: true } : v === 0 ? { item, ok: false, fix } : { item: `${item} (could not check)`, ok: false, optional: true, fix };
  return [row('Accessibility for this terminal app', ax), row('Screen Recording for this terminal app', sr)];
}

/** The OS tools each backend needs (from the package's backends: macOS screencapture/sips/osascript + cliclick; X11 xdotool + ImageMagick import). */
function checks(mode: 'virtual' | 'real'): Array<{ item: string; ok: boolean; fix?: string; optional?: boolean }> {
  if (process.platform === 'darwin') {
    if (mode === 'virtual') return [{ item: 'virtual display', ok: false, fix: 'macOS has no virtual X display — use --real (your screen) or run on Linux' }];
    return [
      { item: 'screencapture + sips (built in)', ok: onPath('screencapture') && onPath('sips') },
      { item: 'cliclick (mouse; REQUIRED on macOS 11)', ok: onPath('cliclick'), fix: 'brew install cliclick' },
      ...macPermissionRows(),
    ];
  }
  const rows = [
    { item: 'xdotool (input)', ok: onPath('xdotool'), fix: 'sudo apt-get install -y xdotool' },
    { item: 'ImageMagick import (screenshots)', ok: onPath('import'), fix: 'sudo apt-get install -y imagemagick' },
  ];
  if (mode === 'virtual') rows.push({ item: 'Xvfb (the private display)', ok: onPath('Xvfb'), fix: 'sudo apt-get install -y xvfb' });
  else rows.push({ item: '$DISPLAY (your X session)', ok: !!process.env.DISPLAY, fix: 'run from inside your desktop session' });
  return rows;
}

export async function runDesktop(action: string | undefined, opts: { virtual?: boolean; real?: boolean; yes?: boolean; json?: boolean }): Promise<number> {
  switch (action ?? 'status') {
    case 'status': {
      const d = resolveDesktop();
      if (opts.json) { console.log(JSON.stringify(d)); return 0; }
      console.log(`desktop: ${d.mode}${d.using ? ' — ACTIVE (served as nexus-desktop)' : ` — ${d.reason}`}`);
      if (d.mode !== 'off') for (const r of checks(d.mode)) console.log(`${r.ok ? '  ok ' : r.optional ? '  -- ' : '  NO '} ${r.item}${r.ok ? '' : r.fix ? `  → ${r.fix}` : ''}`);
      return 0;
    }
    case 'enable': {
      const mode: 'virtual' | 'real' = opts.real ? 'real' : 'virtual';
      if (opts.real && opts.virtual) { console.error('choose one: --virtual or --real'); return 2; }
      if (mode === 'real') {
        if (opts.yes || !tty()) { console.error('Refused: desktop --real lets an agent move YOUR mouse and type on YOUR screen. It is only enabled interactively — run `cortex desktop enable --real` in a terminal and confirm.'); return 1; }
        const { confirm } = await inquirer.prompt([{ type: 'input', name: 'confirm',
          message: 'An agent will be able to see your screen and use your mouse and keyboard. Failsafe: park the cursor at the middle of the top edge (macOS) / top-left (Linux) to stop it; delete the stop file to resume. Type "enable real desktop" to continue:' }]);
        if (String(confirm).trim().toLowerCase() !== 'enable real desktop') { console.log('Not enabled.'); return 1; }
      }
      const rows = checks(mode); const missing = rows.filter(r => !r.ok && !r.optional);
      for (const r of rows) console.log(`${r.ok ? '  ok ' : r.optional ? '  -- ' : '  NO '} ${r.item}${r.ok ? '' : r.fix ? `  → ${r.fix}` : ''}`);
      setDesktop(mode);
      const d = resolveDesktop();
      if (!d.using) { console.log(`NEXUS_DESKTOP=${mode} saved, but ${d.reason}. ${d.reason.includes('not installed') ? NOT_INSTALLED : ''}`); return 1; }
      console.log(`NEXUS_DESKTOP=${mode} — new sessions get the \`desktop\` tool (nexus-desktop).${missing.length ? ` Install the missing tools above first: ${missing.length} missing.` : ''}`);
      return missing.length ? 1 : 0;
    }
    case 'install': {
      // 2026-11-13: fetch @nexus-cortex/desktop from npm (beside nexus-cortex), then offer to turn it on. Enabling stays a separate,
      // confirmed step: on macOS it means YOUR screen (typed confirmation), so it only runs at a terminal.
      if (!npmInstallGlobal([`${OPTIONAL_PACKAGES.desktop}@latest`])) { console.error(`npm could not install ${OPTIONAL_PACKAGES.desktop} (see above). If it is a permissions error: sudo npm install -g ${OPTIONAL_PACKAGES.desktop}`); return 1; }
      const args = setupArgs('desktop', tty());
      if (!args) { console.log('Installed. Turn it on in a terminal: cortex desktop enable --real'); return 0; }
      return runCortex(args);
    }
    case 'disable': { setDesktop(''); console.log('NEXUS_DESKTOP cleared — the desktop tool is off for new sessions.'); return 0; }
    default:
      console.error('usage: cortex desktop status | install | enable [--virtual|--real] | disable');
      return 2;
  }
}
