/**
 * The optional, separately licensed packages a user can add to a nexus-cortex install (operator 2026-11-13: "I just want to run
 * `cortex update --browser --desktop` and be done with it … then a subsequent `cortex update` updates all packages installed").
 *
 *   @nexus-cortex/browser — the local browser (NEXUS_BROWSER_MODE=local)    AGPL-3.0-only OR Spitfire commercial
 *   @nexus-cortex/desktop — the desktop tool (NEXUS_DESKTOP=virtual|real)    AGPL-3.0-only OR Spitfire commercial
 *
 * Both install GLOBALLY beside nexus-cortex (the same `npm install -g` prefix), which is where core's resolvers look
 * (config/localBrowser.ts, config/localDesktop.ts). Detection uses `npm ls -g` so it sees exactly that prefix.
 */
import { spawnSync } from 'node:child_process';

export const OPTIONAL_PACKAGES = {
  browser: '@nexus-cortex/browser',
  desktop: '@nexus-cortex/desktop',
} as const;
export type OptionalKind = keyof typeof OPTIONAL_PACKAGES;
export const OPTIONAL_KINDS = Object.keys(OPTIONAL_PACKAGES) as OptionalKind[];

const isWin = process.platform === 'win32';

/** Which optional packages are installed globally (best-effort: an npm failure reads as "none"). */
export function installedOptionalPackages(): OptionalKind[] {
  const r = spawnSync('npm', ['ls', '-g', '--depth=0', '--json'], { encoding: 'utf8', shell: isWin });
  try {
    const deps = (JSON.parse(r.stdout || '{}') as { dependencies?: Record<string, unknown> }).dependencies ?? {};
    return OPTIONAL_KINDS.filter((k) => Object.prototype.hasOwnProperty.call(deps, OPTIONAL_PACKAGES[k]));
  } catch {
    return [];
  }
}

/** `npm install -g <specs…>` in one resolve, output shown to the user. */
export function npmInstallGlobal(specs: string[]): boolean {
  const r = spawnSync('npm', ['install', '-g', ...specs], { stdio: 'inherit', shell: isWin });
  return r.status === 0;
}

/** Run the (freshly installed) `cortex` bin for a follow-up step — a new process loads the new install, never this one's cache. */
export function runCortex(args: string[], extraEnv: Record<string, string> = {}): number {
  const r = spawnSync('cortex', args, { stdio: 'inherit', shell: isWin, env: { ...process.env, ...extraEnv } });
  return r.status ?? 1;
}

/** The follow-up that makes a just-installed package usable: the browser installs its runtime pieces; the desktop asks to be enabled. */
export function setupArgs(kind: OptionalKind, interactive: boolean): string[] | null {
  if (kind === 'browser') return ['browser', 'install', '--yes'];
  // Desktop: macOS has only the real screen (typed confirmation, so a terminal is required); Linux defaults to the private virtual display.
  if (process.platform === 'darwin') return interactive ? ['desktop', 'enable', '--real'] : null;
  return ['desktop', 'enable', '--virtual', '--yes'];
}
