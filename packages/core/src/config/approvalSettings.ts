/**
 * approvalSettings — the starting auto-approve mode of a session, decided ONCE in the library (operator 2026-11-14: "auto approve should be
 * able to be set in the cortex settings config json file … I am getting tired of having to be there to approve actions when the tui agent is
 * restarted").
 *
 * The setting lives in the USER's global config file — `~/.cortex/config.json` (CORTEX_HOME relocates it), the same file that carries the
 * TUI theme and default model:
 *
 *   { "autoApprove": true }                                   every surface
 *   { "fuzzycortex": { "autoApprove": true } }                one surface (fuzzycortex | neoncortex | cortexserver | cli)
 *
 * Precedence (TERMINAL sessions — the TUIs, an interactive `cortex`): the surface's own key → the top-level key → OFF.
 * A process with NO terminal (server, one-shot `cortex "<task>"`, benches, hosted sandboxes) is always ON: nobody can answer a prompt,
 * so the file is not read for it.
 *
 * A PROJECT's `.cortex/config.json` (a tracked file, cloned with the repo) is NEVER honoured for this key: a repo that ships
 * `"autoApprove": true` would otherwise switch approval off for whoever opens it. When such a key is found it is reported in `ignored`.
 *
 * Auto-approve never lifts the FLOORS (floor-* policies: native automation, key-in-file, load_session …) — PermissionsMiddleware refuses
 * those at once when nobody is asked. The CortexOrchestrator constructor calls this, so every surface (CLI one-shot, both TUIs, the server,
 * SDK callers) and both turn routes (sendMessage and streamMessage read the same approvalMode) start from the same answer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getGlobalConfigDir } from './SettingsLoader.js';

export type ApprovalSource = 'config:surface' | 'config' | 'default';

export interface InitialApprovalMode {
  autoApproveActions: boolean;
  /** Where the answer came from. `default` = no key set (terminal → OFF, no terminal → ON). */
  source: ApprovalSource;
  /** A project-local config.json that carries an autoApprove key we refused to honour (absolute path), if any. */
  ignored?: string;
}

export interface ResolveApprovalOptions {
  /** The running surface: fuzzycortex | neoncortex | cortexserver | cli (any other name reads only the top-level key). */
  surface?: string;
  /** Whether a person is at a terminal. Default: stdin AND stdout are TTYs. */
  isInteractive?: boolean;
  /** The global config file. Default: <getGlobalConfigDir()>/config.json. */
  globalConfigFile?: string;
  /** The project directory whose `.cortex/config.json` is checked (and ignored) for the key. Default: process.cwd(). */
  projectDir?: string;
}

/** `<CORTEX_HOME or ~>/.cortex/config.json`. */
export function globalUiConfigPath(): string {
  return path.join(getGlobalConfigDir(), 'config.json');
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    const v = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined; // an unreadable / malformed file never changes approval
  }
}

/** The autoApprove value a config object sets for `surface`, or undefined. Only a real boolean counts ("true" the string does not). */
function autoApproveIn(cfg: Record<string, unknown> | undefined, surface?: string): { value: boolean; source: ApprovalSource } | undefined {
  if (!cfg) return undefined;
  if (surface) {
    const s = cfg[surface];
    if (s && typeof s === 'object' && typeof (s as Record<string, unknown>).autoApprove === 'boolean') {
      return { value: (s as Record<string, unknown>).autoApprove as boolean, source: 'config:surface' };
    }
  }
  if (typeof cfg.autoApprove === 'boolean') return { value: cfg.autoApprove, source: 'config' };
  return undefined;
}

/** True when any surface section or the top level of `cfg` carries an autoApprove key. */
function hasAnyAutoApprove(cfg: Record<string, unknown> | undefined): boolean {
  if (!cfg) return false;
  if ('autoApprove' in cfg) return true;
  return Object.values(cfg).some((v) => !!v && typeof v === 'object' && 'autoApprove' in (v as Record<string, unknown>));
}

/** The session's starting auto-approve mode. Pure apart from reading the two files; never throws. */
export function resolveInitialApprovalMode(opts: ResolveApprovalOptions = {}): InitialApprovalMode {
  const isInteractive = opts.isInteractive ?? !!(process.stdin.isTTY && process.stdout.isTTY);
  const globalFile = path.resolve(opts.globalConfigFile ?? globalUiConfigPath());
  const projectFile = path.resolve(opts.projectDir ?? process.cwd(), '.cortex', 'config.json');

  const ignored = projectFile !== globalFile && hasAnyAutoApprove(readJson(projectFile)) ? projectFile : undefined;
  // No terminal (server, `cortex "<task>"`, benches, hosted sandboxes, scheduled turns): nobody can answer a prompt, so these stay ON
  // whatever the file says — a configured `false` there would leave every approval waiting on no one.
  const fromGlobal = isInteractive ? autoApproveIn(readJson(globalFile), opts.surface) : undefined;
  const base = fromGlobal
    ? { autoApproveActions: fromGlobal.value, source: fromGlobal.source }
    : { autoApproveActions: !isInteractive, source: 'default' as const };
  return ignored ? { ...base, ignored } : base;
}

/** One line for a surface to print at start, or undefined when nothing was configured. Never names a value other than ON/OFF. */
export function describeInitialApprovalMode(m: InitialApprovalMode, surface?: string): string | undefined {
  const parts: string[] = [];
  if (m.source !== 'default') {
    parts.push(`auto-approve ${m.autoApproveActions ? 'ON' : 'OFF'} from ${globalUiConfigPath()}${m.source === 'config:surface' && surface ? ` (${surface}.autoApprove)` : ' (autoApprove)'}`);
  }
  if (m.ignored) parts.push(`ignored autoApprove in project file ${m.ignored} — set it in ${globalUiConfigPath()} instead`);
  return parts.length ? parts.join('; ') : undefined;
}

/**
 * Persist the setting in the USER's ~/.cortex/config.json (the only file the resolver honours), keeping every other key (theme, model …).
 * `surface` set → `<surface>.autoApprove`; omitted → the top-level `autoApprove`. `value: undefined` removes the key. Returns the path.
 * Used by `cortex permissions auto-approve --enable|--disable` outside a live session, so the command and the next TUI start agree.
 */
export function persistAutoApprove(value: boolean | undefined, opts: { surface?: string; globalConfigFile?: string } = {}): string {
  const file = path.resolve(opts.globalConfigFile ?? globalUiConfigPath());
  const cfg: Record<string, unknown> = readJson(file) ?? {};
  if (opts.surface) {
    const cur = cfg[opts.surface];
    const sec: Record<string, unknown> = cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...(cur as Record<string, unknown>) } : {};
    if (value === undefined) delete sec.autoApprove; else sec.autoApprove = value;
    cfg[opts.surface] = sec;
  } else if (value === undefined) delete cfg.autoApprove;
  else cfg.autoApprove = value;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
  return file;
}
