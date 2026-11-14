/**
 * `cortex browser status | install [--yes] | use <local|hosted>` — which browser the harness drives (NEXUS_BROWSER_MODE).
 *
 * Policy (operator 2026-11-03): choosing the local browser IS the approval, and everything it needs is installed in that step — at
 * `cortex setup` (the install-time option) or here. Nothing installs at runtime otherwise; with no person present (bench containers,
 * scripts) nothing is installed unless the command says so explicitly (`--yes`, e.g. in an image build), and the harness keeps using
 * the hosted browser MCP. The local browser is the separately licensed @nexus-cortex/browser package (AGPL-3.0-only OR commercial);
 * this command only drives its installer.
 */
import inquirer from 'inquirer';
import { SettingsLoader, getGlobalConfigDir, resolveBrowserBackend } from '@nexus-cortex/core';
import { OPTIONAL_PACKAGES, npmInstallGlobal, runCortex } from '../../lifecycle/optionalPackages.js';

/** Optional parts of the local browser (package 0.8.6+; older packages ignore them). Omitted = the previous choice, else the platform default. */
export interface BrowserExtras { pdf?: boolean; sandbox?: boolean }
interface BrowserPkg {
  checkAll(): Array<{ area: string; item: string; ok: boolean; optional: boolean; fix?: string }>;
  readiness(rows?: unknown): { core: boolean; sandbox: boolean };
  installPlan(rows?: unknown, extras?: BrowserExtras): { steps: string[]; approxMB: number };
  installAll(opts: { interactive: boolean; log?: (l: string) => void; extras?: BrowserExtras }): Promise<{ ready: { core: boolean; sandbox: boolean }; done: string[]; manual: string[] }>;
  toolsHome(): string;
}

/** The optional local browser package, or null when it is not installed. */
export async function loadBrowserPackage(): Promise<BrowserPkg | null> {
  const spec = '@nexus-cortex/browser';   // optional, separately licensed: a runtime import, never a build dependency
  // 2026-11-13: Node 22 prints "ExperimentalWarning: SQLite is an experimental feature" when the package loads node:sqlite — noise in
  // the middle of the install prompt. Drop that one warning; every other warning still prints.
  const emit = process.emitWarning.bind(process);
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (/SQLite is an experimental feature/.test(String(typeof w === 'string' ? w : w?.message))) return;
    return (emit as (...a: unknown[]) => void)(w, ...rest);
  }) as typeof process.emitWarning;
  try { return (await import(spec)) as unknown as BrowserPkg; } catch (e: unknown) {
    // 2026-11-06: a package that IS installed but fails to load (Node 20 has no node:sqlite) used to read as "not installed" — say why.
    const code = (e as { code?: string })?.code;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') {
      console.error(`[cortex browser] @nexus-cortex/browser is installed but failed to load on Node ${process.version}: ${String((e as Error)?.message ?? e).slice(0, 200)} (it needs Node >= 22.13)`);
    }
    return null;
  }
}

const tty = () => !!process.stdin.isTTY && !!process.stdout.isTTY;
const NOT_INSTALLED = 'The local browser package (@nexus-cortex/browser) is not installed on this machine, so the harness uses the hosted browser MCP. Install it with: cortex browser install';

function setMode(mode: 'local' | 'hosted'): void {
  new SettingsLoader(getGlobalConfigDir()).setMultiple({ NEXUS_BROWSER_MODE: mode } as never);
  process.env.NEXUS_BROWSER_MODE = mode;
}

/**
 * Install the local browser and switch to it. Call only after the user chose it (`approved`), or at a terminal where they will be
 * asked here. Shared by `cortex setup` and `cortex browser install`.
 */
export async function installLocalBrowser(opts: { approved: boolean; out?: (s: string) => void; extras?: BrowserExtras }): Promise<{ ok: boolean; message: string }> {
  const out = opts.out ?? ((s: string) => console.log(s));
  const pkg = await loadBrowserPackage();
  if (!pkg) {
    // 2026-11-13 (operator: "cortex browser install … and be done with it"): fetch the package itself from npm, then finish the setup in
    // a fresh process (this one cannot import a module installed after it started). The env marker stops a loop if npm "succeeded"
    // but the package still does not load.
    if (process.env.CORTEX_BROWSER_PKG_JUST_INSTALLED === '1') return { ok: false, message: `${NOT_INSTALLED} (npm installed it, but it does not load — check \`npm ls -g @nexus-cortex/browser\` and your Node version: it needs Node >= 22.13)` };
    out(`Installing ${OPTIONAL_PACKAGES.browser} from npm…`);
    if (!npmInstallGlobal([`${OPTIONAL_PACKAGES.browser}@latest`])) return { ok: false, message: `npm could not install ${OPTIONAL_PACKAGES.browser} (see above). If it is a permissions error: sudo npm install -g ${OPTIONAL_PACKAGES.browser}` };
    const flags = [...(opts.extras?.pdf === true ? ['--pdf'] : opts.extras?.pdf === false ? ['--no-pdf'] : []), ...(opts.extras?.sandbox === true ? ['--sandbox'] : opts.extras?.sandbox === false ? ['--no-sandbox'] : [])];
    const code = runCortex(['browser', 'install', ...(opts.approved ? ['--yes'] : []), ...flags], { CORTEX_BROWSER_PKG_JUST_INSTALLED: '1' });
    return { ok: code === 0, message: code === 0 ? '' : 'The local browser setup did not finish (see above).' };
  }
  const plan = pkg.installPlan(undefined, opts.extras);
  if (plan.steps.length && !opts.approved) {
    if (!tty()) return { ok: false, message: 'Nothing installed: no one is here to approve it. Run `cortex browser install --yes` to choose the local browser explicitly (for example in an image build); until then the hosted browser MCP is used.' };
    out('The local browser needs:');
    for (const s of plan.steps) out(`  - ${s}`);
    out(`  (about ${plan.approxMB} MB, once)`);
    const { ok } = await inquirer.prompt<{ ok: boolean }>([{ type: 'confirm', name: 'ok', message: 'Install it now?', default: true }]);
    if (!ok) return { ok: false, message: 'Nothing installed; the hosted browser MCP stays in use.' };
  }
  // Always run the installer once chosen: with nothing missing it only records readiness (<tools home>/install.json), which is what
  // the harness checks before it switches to the local browser.
  const r = await pkg.installAll({ interactive: tty(), log: (l) => out(`  ${l}`), extras: opts.extras });
  for (const d of r.done) out(`  installed: ${d}`);
  for (const m of r.manual) out(`  not installed — ${m}`);
  if (!r.ready.core) return { ok: false, message: 'The local browser is not ready (see above); the hosted browser MCP stays in use.' };
  setMode('local');
  return { ok: true, message: `Local browser ready${r.ready.sandbox ? ' (including the sandbox backend: real Chrome, incognito, live view)' : (process.platform === 'linux' ? ' (default backend; the sandbox backend still needs the items above)' : ' (default backend; the sandbox backend is Linux-only)')} — NEXUS_BROWSER_MODE=local.` };
}

export async function runBrowser(action: string | undefined, args: string[], opts: { yes?: boolean; json?: boolean; pdf?: boolean; sandbox?: boolean }): Promise<number> {
  switch (action ?? 'status') {
    case 'status': {
      const b = resolveBrowserBackend();
      const pkg = await loadBrowserPackage();
      const rows = pkg ? pkg.checkAll() : [];
      if (opts.json) { console.log(JSON.stringify({ ...b, packageInstalled: !!pkg, checks: rows })); return 0; }
      console.log(`browser: ${b.using}${b.mode !== b.using ? ` (NEXUS_BROWSER_MODE=${b.mode}, but ${b.reason})` : ` — ${b.reason}`}`);
      if (!pkg) { console.log(NOT_INSTALLED); return 0; }
      for (const r of rows) console.log(`${r.ok ? '  ok ' : r.optional ? '  -- ' : '  NO '} ${r.area.padEnd(11)} ${r.item.padEnd(46).slice(0, 46)} ${r.ok ? '' : r.fix ?? ''}`);
      const ready = pkg.readiness(rows);
      console.log(`local core: ${ready.core ? 'READY' : 'NOT READY'} · sandbox backend: ${ready.sandbox ? 'READY' : 'NOT READY'}${ready.core && b.mode !== 'local' ? ' · switch with `cortex browser use local`' : ''}`);
      return 0;
    }
    case 'install': {
      const extras: BrowserExtras = { ...(opts.pdf !== undefined ? { pdf: opts.pdf } : {}), ...(opts.sandbox !== undefined ? { sandbox: opts.sandbox } : {}) };
      const r = await installLocalBrowser({ approved: !!opts.yes, extras });
      if (r.message) console.log(r.message);
      return r.ok ? 0 : 1;
    }
    case 'use': {
      const to = args[0];
      if (to === 'hosted') { setMode('hosted'); console.log('NEXUS_BROWSER_MODE=hosted — the harness uses the hosted browser MCP.'); return 0; }
      if (to === 'local') {
        const pkg = await loadBrowserPackage();
        if (!pkg) { console.log(NOT_INSTALLED); return 1; }
        if (!pkg.readiness().core) { console.log('The local browser is not installed yet — run `cortex browser install`.'); return 1; }
        setMode('local'); console.log('NEXUS_BROWSER_MODE=local — the harness drives the local browser.'); return 0;
      }
      console.error('usage: cortex browser use <local|hosted>'); return 2;
    }
    default:
      console.error('usage: cortex browser status | install [--yes] [--pdf|--no-pdf] [--sandbox|--no-sandbox] | use <local|hosted>');
      return 2;
  }
}
