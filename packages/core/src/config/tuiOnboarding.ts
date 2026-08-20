/**
 * TUI first-run onboarding block (L-05 + S-03, TUI_UX_BACKLOG_2026-08-16).
 *
 * Before this, first paint was a bare prompt: no statement of what the tool
 * is, no example, no pointer to the slash-command surface — the splash screen
 * existed but was reachable only via /about. Canonical-in-the-library: the
 * CONTENT lives here; each TUI wrapper styles and prints it.
 *
 * RULES:
 *  - Advertise ONLY features that exist on the surface rendering the block.
 *    (The backlog's own "@file/!shell" phrasing was ungrounded — neither is
 *    implemented anywhere in this repo; they are deliberately absent here.)
 *  - Key hints come from TUI_KEYMAP, never hardcoded (L-08 rule).
 *  - Shown once per machine (~/.cortex/onboarded marker), because the block
 *    is orientation, not chrome. Wrappers may re-show it via /about.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getGlobalConfigDir } from './SettingsLoader.js';
import { keymapFooterHint, type TuiSurface } from './tuiKeymap.js';

/** Plain-text onboarding lines — wrappers apply their own styling. */
export function onboardingLines(surface: TuiSurface): string[] {
  return [
    'cortex — an agentic coding assistant in your terminal.',
    'Ask in plain language; it reads files, runs commands, and edits code.',
    '',
    'Try:  explain this repo    or    fix the failing test in src/',
    '',
    'Type / for the command palette — /help lists everything, /model switches models.',
    keymapFooterHint(surface),
  ];
}

const ONBOARDED_MARKER = 'onboarded';

/** True when this machine has never shown the first-run block. Fails closed
 *  (returns false) on filesystem errors so a broken home dir never loops the
 *  block forever. `configDir` is injectable for tests (vitest worker threads
 *  proxy process.env, so os.homedir() can't be steered via $HOME there). */
export function shouldShowOnboarding(configDir: string = getGlobalConfigDir()): boolean {
  try {
    return !fs.existsSync(path.join(configDir, ONBOARDED_MARKER));
  } catch {
    return false;
  }
}

/** Persist the shown-once marker. Non-fatal on failure. */
export function markOnboardingShown(configDir: string = getGlobalConfigDir()): void {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, ONBOARDED_MARKER), `${new Date().toISOString()}\n`);
  } catch {
    /* non-fatal — worst case the block shows again next launch */
  }
}
