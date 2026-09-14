/**
 * TmuxManager - Singleton for managing tmux sessions
 * Handles persistent terminal session lifecycle and operations
 */
import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import * as crypto from 'crypto';

const execAsync = promisify(exec);

/**
 * HB-TMUX-PASTE-BUFFER (R140, 2026-09-14): argv exec for the send paths (no host-shell
 * quoting, so `$?` and quotes reach the session verbatim). Injectable for tests.
 */
export interface TmuxExecResult {
  stdout: string;
  stderr: string;
}
export interface TmuxExecOptions {
  /** R139: hard cap; the child is killed (SIGTERM) and the call rejects with `killed: true`. */
  timeoutMs?: number;
}
export type TmuxExecFn = (bin: string, args: string[], opts?: TmuxExecOptions) => Promise<TmuxExecResult>;
/**
 * Default exec: argv execFile; with `timeoutMs` the cap is enforced by our own timer
 * (SIGKILL + a rejection carrying `killed: true`). execFile's own `timeout` cannot be
 * trusted here: the tmux client traps SIGTERM and exits 0, which execFile reports as
 * success (smoke 2026-09-14: a capped `wait-for` came back "signaled").
 */
export const defaultTmuxExec: TmuxExecFn = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    let timedOut = false;
    const child = execFile(bin, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        const err: any = new Error(`${bin} ${args.slice(0, 2).join(' ')} did not return within ${opts?.timeoutMs}ms`);
        err.killed = true;
        err.signal = 'SIGKILL';
        reject(err);
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }, opts.timeoutMs)
      : undefined;
  });

/**
 * HB-TMUX-SELF-INSTALL (R138, 2026-09-14): non-throwing, time-bounded exec for the install
 * steps (package manager / static download). Returns the exit code; a cap expiry or a
 * missing binary is `code: null`. Injectable for tests.
 */
export interface TmuxInstallExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type TmuxInstallExecFn = (bin: string, args: string[], opts: { timeoutMs: number }) => Promise<TmuxInstallExecResult>;
export const defaultTmuxInstallExec: TmuxInstallExecFn = (bin, args, opts) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });
    } catch (err: any) {
      stderr = String(err?.message ?? err);
      resolve({ code: null, stdout, stderr });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      stderr += `\n[timeout after ${opts.timeoutMs}ms]`;
      finish(null);
    }, opts.timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => { stderr += String(err?.message ?? err); finish(null); });
    child.on('close', (code) => finish(code));
  });

export interface TmuxEnsureOptions {
  /** Override the CORTEX_TMUX_AUTO_INSTALL lever (false = never attempt an install). */
  allowInstall?: boolean;
  /** Per-step cap (default 120000). */
  timeoutMs?: number;
  /** Lever source (tests); default process.env. */
  env?: NodeJS.ProcessEnv;
  /** One-line logger (tests); default console.log / console.warn by prefix. */
  log?: (line: string) => void;
}

export interface TmuxEnsureResult {
  available: boolean;
  /** The step that produced a working binary (apt-get | apk | dnf | yum | brew | static-url). */
  installedVia?: string;
  /** Steps attempted, in order. */
  tried: string[];
  /** Set when no attempt was made because the lever / allowInstall said so. */
  skipped?: 'lever';
}

export const TMUX_INSTALL_STEP_TIMEOUT_MS = 120000;

/** Package-manager steps in trial order (Terminus _get_combined_install_command: apt / apk / yum). */
const TMUX_PACKAGE_MANAGER_STEPS: { name: string; commands: string[][]; tolerateFailure?: number[] }[] = [
  {
    name: 'apt-get',
    // Expired-Release tolerance on the update step (the bench adapter's flags); the update
    // step alone never fails the install (index 0 tolerated).
    commands: [
      ['apt-get', '-o', 'Acquire::Check-Valid-Until=false', '-o', 'Acquire::AllowInsecureRepositories=true', 'update'],
      ['apt-get', 'install', '-y', '--no-install-recommends', 'tmux'],
    ],
    tolerateFailure: [0],
  },
  { name: 'apk', commands: [['apk', 'add', 'tmux']] },
  { name: 'dnf', commands: [['dnf', 'install', '-y', 'tmux']] },
  { name: 'yum', commands: [['yum', 'install', '-y', 'tmux']] },
  { name: 'brew', commands: [['brew', 'install', 'tmux']] },
];

export function readTmuxAutoInstallLever(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CORTEX_TMUX_AUTO_INSTALL || '').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'off' || raw === 'no');
}

/** R141: scrollback kept per pane (CORTEX_TMUX_HISTORY_LIMIT, default 50000). */
export const TMUX_DEFAULT_HISTORY_LIMIT = 50000;
export function readTmuxHistoryLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number((env.CORTEX_TMUX_HISTORY_LIMIT || '').trim());
  return Number.isInteger(n) && n > 0 ? n : TMUX_DEFAULT_HISTORY_LIMIT;
}

/** R141: fixed pane geometry at creation (CORTEX_TMUX_PANE_SIZE=WxH, default 160x40 like Terminus). */
export const TMUX_DEFAULT_PANE_SIZE = { width: 160, height: 40 } as const;
export function readTmuxPaneSize(env: NodeJS.ProcessEnv = process.env): { width: number; height: number } {
  const m = (env.CORTEX_TMUX_PANE_SIZE || '').trim().match(/^(\d{2,4})x(\d{1,4})$/i);
  if (!m) return { ...TMUX_DEFAULT_PANE_SIZE };
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : { ...TMUX_DEFAULT_PANE_SIZE };
}

/**
 * R140: input above this many bytes (or containing a newline) is delivered with
 * `load-buffer` + `paste-buffer` instead of one `send-keys` argument (Terminus 2
 * batches keys to the send-keys size limit and pastes oversize input the same way;
 * TB4.0 rs-archive-clone lost a heredoc to the argument limit).
 */
export const TMUX_SEND_KEYS_MAX_CHARS = 2000;

export function needsPasteBuffer(text: string): boolean {
  return text.includes('\n') || Buffer.byteLength(text, 'utf8') > TMUX_SEND_KEYS_MAX_CHARS;
}

export interface TmuxSendOptions {
  /** Press Enter after the text (default true). */
  enter?: boolean;
}

/**
 * TmuxBinaryLocator - Robust tmux binary discovery
 * Searches multiple locations with priority order and validation
 */
class TmuxBinaryLocator {
  private cachedPath: string | null | undefined = undefined;

  /**
   * Find tmux binary with comprehensive search
   */
  private findBinary(): string | null {
    // 1. Environment variable (highest priority - user override)
    if (process.env.TMUX_BIN) {
      if (this.isExecutable(process.env.TMUX_BIN)) {
        console.log(`[TmuxManager] Using TMUX_BIN: ${process.env.TMUX_BIN}`);
        return process.env.TMUX_BIN;
      }
      console.warn(`[TmuxManager] TMUX_BIN set but not executable: ${process.env.TMUX_BIN}`);
    }

    // 2. Nix profile locations (common on Replit, NixOS)
    const homeDir = process.env.HOME;
    if (homeDir) {
      const nixPaths = [
        join(homeDir, '.nix-profile/bin/tmux'),
        join(homeDir, '.local/state/nix/profiles/profile/bin/tmux'),
        join(homeDir, '.local/bin/tmux'), // R138 static-binary drop target
      ];

      for (const path of nixPaths) {
        if (this.isExecutable(path)) {
          console.log(`[TmuxManager] Found tmux (nix profile): ${path}`);
          return path;
        }
      }
    }

    // 3. System-wide nix locations
    const systemNixPaths = [
      '/nix/var/nix/profiles/default/bin/tmux',
      '/run/current-system/sw/bin/tmux',
    ];

    for (const path of systemNixPaths) {
      if (this.isExecutable(path)) {
        console.log(`[TmuxManager] Found tmux (system nix): ${path}`);
        return path;
      }
    }

    // 4. Standard system paths
    const systemPaths = [
      '/usr/bin/tmux',
      '/usr/local/bin/tmux',
      '/opt/homebrew/bin/tmux',     // macOS Apple Silicon
      '/home/linuxbrew/.linuxbrew/bin/tmux',  // Linux Homebrew
    ];

    for (const path of systemPaths) {
      if (this.isExecutable(path)) {
        console.log(`[TmuxManager] Found tmux (system): ${path}`);
        return path;
      }
    }

    // 5. PATH lookup, resolved to an absolute path so the in-session `tmux wait-for -S`
    //    (R139) works even when the session shell's PATH differs from ours.
    for (const dir of (process.env.PATH || '').split(':')) {
      if (!dir) continue;
      const candidate = join(dir, 'tmux');
      if (this.isExecutable(candidate)) {
        console.log(`[TmuxManager] Found tmux (PATH): ${candidate}`);
        return candidate;
      }
    }

    // 6. Fallback to PATH (let shell resolve)
    console.log(`[TmuxManager] Using 'tmux' from PATH (last resort)`);
    return 'tmux';
  }

  /**
   * Check if path is an executable file
   */
  private isExecutable(path: string): boolean {
    try {
      if (!existsSync(path)) return false;
      const stats = statSync(path);
      // Check if file and has execute permission
      return stats.isFile() && !!(stats.mode & 0o111);
    } catch {
      return false;
    }
  }

  /**
   * Get tmux binary path (cached)
   */
  public getBinary(): string {
    if (this.cachedPath === undefined) {
      this.cachedPath = this.findBinary();
    }

    if (!this.cachedPath) {
      throw new Error(
        'tmux binary not found. Please install tmux or set TMUX_BIN environment variable.\n\n' +
        'Install commands:\n' +
        ' - Ubuntu/Debian: sudo apt-get install tmux\n' +
        ' - macOS: brew install tmux\n' +
        ' - NixOS/Nix: nix-env -iA nixpkgs.tmux\n' +
        ' - Replit: Add tmux in the Packages tab\n' +
        ' - Docker: RUN apt-get update && apt-get install -y tmux\n\n' +
        'Or set environment variable:\n' +
        ' export TMUX_BIN=/path/to/tmux'
      );
    }

    return this.cachedPath;
  }

  /**
   * Clear cache (for testing or when binary location changes)
   */
  public clearCache(): void {
    this.cachedPath = undefined;
  }
}

// Singleton instance
const tmuxLocator = new TmuxBinaryLocator();

// Export function for backward compatibility
function getTmuxBin(): string {
  return tmuxLocator.getBinary();
}

export interface TmuxSessionMetadata {
  sessionId: string;
  created: Date;
  lastUsed: Date;
  cwd?: string;
  env?: Record<string, string>;
}

export class TmuxManager {
  private static instance: TmuxManager;
  private tmuxAvailable: boolean | null = null;
  /** R138: the per-process install attempt (one attempt, one log line, cached outcome). */
  private installAttempt: Promise<TmuxEnsureResult> | null = null;
  private readonly installExec: TmuxInstallExecFn;

  private constructor(
    private readonly exec: TmuxExecFn = defaultTmuxExec,
    deps: { installExec?: TmuxInstallExecFn } = {},
  ) {
    this.installExec = deps.installExec ?? defaultTmuxInstallExec;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): TmuxManager {
    if (!TmuxManager.instance) {
      TmuxManager.instance = new TmuxManager();
    }
    return TmuxManager.instance;
  }

  /** Test hook (R140/R138): a non-singleton instance with injected execs. */
  public static createWithExec(exec: TmuxExecFn, deps: { installExec?: TmuxInstallExecFn } = {}): TmuxManager {
    return new TmuxManager(exec, deps);
  }

  /** The tmux binary as the locator resolved it (absolute when found; `tmux` = PATH fallback). */
  public getBinaryPath(): string {
    return getTmuxBin();
  }

  /**
   * Check if tmux is installed and available
   */
  public async isAvailable(): Promise<boolean> {
    if (this.tmuxAvailable !== null) {
      return this.tmuxAvailable;
    }

    try {
      await this.exec(getTmuxBin(), ['-V']);
      this.tmuxAvailable = true;
      return true;
    } catch {
      this.tmuxAvailable = false;
      return false;
    }
  }

  /**
   * HB-TMUX-SELF-INSTALL (R138): make tmux available, installing it when it is missing.
   * Order: tmux present -> done; lever off -> skip; package manager (apt-get / apk / dnf /
   * yum / brew, whichever `command -v` finds, each step capped at timeoutMs) -> a static
   * binary from CORTEX_TMUX_STATIC_URL dropped into ~/.local/bin/tmux (skipped when unset)
   * -> give up (the caller degrades, R134). The attempt runs once per process and logs one
   * `[INFO] tmux installed via <step>` or one `[WARN] tmux unavailable after: <steps>`.
   */
  public async ensureTmux(opts: TmuxEnsureOptions = {}): Promise<TmuxEnsureResult> {
    if (await this.isAvailable()) return { available: true, tried: [] };
    const env = opts.env ?? process.env;
    const allow = opts.allowInstall ?? readTmuxAutoInstallLever(env);
    if (!allow) return { available: false, tried: [], skipped: 'lever' };
    if (!this.installAttempt) {
      this.installAttempt = this.attemptInstall(env, opts).catch((err: any) => {
        (opts.log ?? console.warn)(`[WARN] tmux install attempt crashed: ${err?.message ?? err}`);
        return { available: false, tried: [] } as TmuxEnsureResult;
      });
    }
    return this.installAttempt;
  }

  private async attemptInstall(env: NodeJS.ProcessEnv, opts: TmuxEnsureOptions): Promise<TmuxEnsureResult> {
    const timeoutMs = Math.max(1000, Math.floor(opts.timeoutMs ?? TMUX_INSTALL_STEP_TIMEOUT_MS));
    const log = opts.log ?? ((line: string) => (line.startsWith('[WARN]') ? console.warn(line) : console.log(line)));
    const has = async (bin: string) => (await this.installExec('sh', ['-c', `command -v ${bin}`], { timeoutMs })).code === 0;
    const tried: string[] = [];

    for (const step of TMUX_PACKAGE_MANAGER_STEPS) {
      if (!(await has(step.name))) continue;
      tried.push(step.name);
      let ok = true;
      for (let i = 0; i < step.commands.length; i++) {
        const [bin = "", ...args] = step.commands[i]!;
        const res = await this.installExec(bin, args, { timeoutMs });
        if (res.code !== 0 && !(step.tolerateFailure ?? []).includes(i)) { ok = false; break; }
      }
      if (ok && (await this.reprobe())) {
        log(`[INFO] tmux installed via ${step.name}`);
        return { available: true, installedVia: step.name, tried };
      }
    }

    const url = (env.CORTEX_TMUX_STATIC_URL || '').trim();
    if (url) {
      tried.push('static-url');
      const dir = join(env.HOME || homedir(), '.local', 'bin');
      const dest = join(dir, 'tmux');
      try { mkdirSync(dir, { recursive: true }); } catch { /* reported by the download step */ }
      let fetched = false;
      if (await has('curl')) {
        fetched = (await this.installExec('curl', ['-fsSL', url, '-o', dest], { timeoutMs })).code === 0;
      } else if (await has('wget')) {
        fetched = (await this.installExec('wget', ['-qO', dest, url], { timeoutMs })).code === 0;
      }
      if (fetched) {
        try { chmodSync(dest, 0o755); } catch { /* verified by the reprobe below */ }
        if (await this.reprobe()) {
          log(`[INFO] tmux installed via static-url`);
          return { available: true, installedVia: 'static-url', tried };
        }
      }
    }

    const steps = tried.length ? tried.join(', ') : 'no package manager found';
    log(`[WARN] tmux unavailable after: ${steps}${url ? '' : ' (CORTEX_TMUX_STATIC_URL unset)'}`);
    return { available: false, tried };
  }

  /** Re-locate the binary and re-run the `-V` probe after an install step. */
  private async reprobe(): Promise<boolean> {
    tmuxLocator.clearCache();
    this.tmuxAvailable = null;
    return this.isAvailable();
  }

  /**
   * HB-TMUX-WAIT-FOR (R139): block on `tmux wait-for <channel>` under a hard cap. A signal
   * that arrived before the waiter is remembered by tmux (the call returns at once), so the
   * command may append `; tmux wait-for -S <channel>` and the harness wait afterwards.
   * @returns signaled:false when the cap expired (the command is still running; not killed)
   */
  public async waitForChannel(channel: string, timeoutMs: number): Promise<{ signaled: boolean }> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }
    try {
      await this.exec(getTmuxBin(), ['wait-for', channel], { timeoutMs: Math.max(1, Math.floor(timeoutMs)) });
      return { signaled: true };
    } catch (error: any) {
      if (error?.killed || error?.signal === 'SIGTERM' || error?.signal === 'SIGKILL') return { signaled: false };
      throw new Error(`Failed to wait for tmux channel ${channel}: ${error?.message ?? error}`);
    }
  }

  /**
   * Create a new tmux session.
   * R141 (HB-TMUX-CAPTURE-CAP): fixed geometry (-x/-y from CORTEX_TMUX_PANE_SIZE, default
   * 160x40) and a raised history-limit (CORTEX_TMUX_HISTORY_LIMIT, default 50000). The
   * limit is applied on the GLOBAL session options around new-session and restored right
   * after (in the same tmux command sequence) because the first window copies its grid
   * limit at creation — `set-option -t <session>` alone leaves it at 2000 (probed on tmux
   * 3.5a); the session-level option is still set for windows created later.
   * @param id Session identifier (defaults to generated UUID)
   * @param cwd Working directory for the session
   * @param env Environment variables for the session
   * @returns Session ID
   */
  public async createSession(
    id?: string,
    cwd?: string,
    env?: Record<string, string>
  ): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }

    const sessionId = id || crypto.randomUUID();

    // Validate session ID format (alphanumeric + hyphens only)
    if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
      throw new Error(
        'Invalid session ID format. Only alphanumeric characters and hyphens allowed.'
      );
    }

    const bin = getTmuxBin();
    const limit = String(readTmuxHistoryLimit());
    const { width, height } = readTmuxPaneSize();

    try {
      const { stdout } = await this.exec(bin, ['start-server', ';', 'show-options', '-gv', 'history-limit']);
      const previous = stdout.trim();
      const args = [
        'set-option', '-g', 'history-limit', limit, ';',
        'new-session', '-d', '-s', sessionId, '-x', String(width), '-y', String(height),
        ...(cwd ? ['-c', cwd] : []), ';',
        'set-option', '-t', sessionId, 'history-limit', limit,
        ...(/^\d+$/.test(previous) ? [';', 'set-option', '-g', 'history-limit', previous] : []),
      ];
      await this.exec(bin, args);
      for (const [key, value] of Object.entries(env ?? {})) {
        await this.exec(bin, ['set-environment', '-t', sessionId, key, value]);
      }
      return sessionId;
    } catch (error: any) {
      throw new Error(`Failed to create tmux session: ${error.message}`);
    }
  }

  /**
   * Send text (a command) to a tmux session, followed by Enter unless `enter: false`.
   * R140: short single-line text goes as ONE literal `send-keys -l` argument; multi-line
   * or oversize text (> TMUX_SEND_KEYS_MAX_CHARS) is written to a 0600 temp file and
   * delivered with `load-buffer` + `paste-buffer -d -p` (bracketed paste when the pane
   * application asked for it), then Enter is a separate `send-keys`. Text reaches the
   * session verbatim on both paths (no host-shell expansion of `$?`, quotes, backticks).
   * @param sessionId Session identifier
   * @param command Text to send
   */
  public async sendKeys(sessionId: string, command: string, opts: TmuxSendOptions = {}): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }

    try {
      if (needsPasteBuffer(command)) {
        await this.pasteText(sessionId, command);
      } else {
        await this.exec(getTmuxBin(), ['send-keys', '-t', sessionId, '-l', command]);
      }
      if (opts.enter !== false) {
        await this.exec(getTmuxBin(), ['send-keys', '-t', sessionId, 'Enter']);
      }
    } catch (error: any) {
      throw new Error(`Failed to send keys to session: ${error.message}`);
    }
  }

  /**
   * Send tmux KEY NAMES (C-c, Enter, Escape, ...) to a session — no -l, no implicit Enter.
   * @param sessionId Session identifier
   * @param keys Key names as tmux send-keys understands them
   */
  public async sendRawKeys(sessionId: string, keys: string[]): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }
    try {
      await this.exec(getTmuxBin(), ['send-keys', '-t', sessionId, ...keys]);
    } catch (error: any) {
      throw new Error(`Failed to send keys to session: ${error.message}`);
    }
  }

  /** R140 paste path: temp file (0600) -> load-buffer -> paste-buffer -d -p; the file is always deleted. */
  private async pasteText(sessionId: string, text: string): Promise<void> {
    const name = `cortex-${crypto.randomBytes(4).toString('hex')}`;
    const file = join(tmpdir(), `${name}.paste`);
    writeFileSync(file, text, { mode: 0o600 });
    try {
      await this.exec(getTmuxBin(), ['load-buffer', '-b', name, file]);
      await this.exec(getTmuxBin(), ['paste-buffer', '-d', '-p', '-b', name, '-t', sessionId]);
    } finally {
      try { unlinkSync(file); } catch { /* already gone */ }
    }
  }

  /**
   * Capture output from a tmux pane
   * @param sessionId Session identifier
   * @param startLine Starting line (negative for scrollback)
   * @param endLine Ending line
   * @returns Captured output as string
   */
  public async capturePane(
    sessionId: string,
    startLine?: number,
    endLine?: number
  ): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }

    try {
      let command = `${getTmuxBin()} capture-pane -t ${sessionId} -p`;

      if (startLine !== undefined) {
        command += ` -S ${startLine}`;
      }

      if (endLine !== undefined) {
        command += ` -E ${endLine}`;
      }

      const { stdout } = await execAsync(command);
      return stdout;
    } catch (error: any) {
      throw new Error(`Failed to capture pane: ${error.message}`);
    }
  }

  /**
   * List all active tmux sessions
   * @returns Array of session IDs
   */
  public async listSessions(): Promise<string[]> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }

    try {
      const { stdout } = await execAsync(`${getTmuxBin()} list-sessions -F "#{session_name}"`);
      return stdout
        .trim()
        .split('\n')
        .filter(line => line.length > 0);
    } catch (error: any) {
      // If no sessions exist, tmux returns error - return empty array
      if (error.message.includes('no server running')) {
        return [];
      }
      throw new Error(`Failed to list sessions: ${error.message}`);
    }
  }

  /**
   * Kill (terminate) a tmux session
   * @param sessionId Session identifier
   */
  public async killSession(sessionId: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }

    try {
      await execAsync(`${getTmuxBin()} kill-session -t ${sessionId}`);
    } catch (error: any) {
      throw new Error(`Failed to kill session: ${error.message}`);
    }
  }

  /**
   * Check if a specific session exists
   * @param sessionId Session identifier
   * @returns True if session exists
   */
  public async sessionExists(sessionId: string): Promise<boolean> {
    if (!(await this.isAvailable())) {
      return false;
    }

    try {
      await execAsync(`${getTmuxBin()} has-session -t ${sessionId}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current working directory of a session
   * @param sessionId Session identifier
   * @returns Current working directory
   */
  public async getSessionCwd(sessionId: string): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }

    try {
      const { stdout } = await execAsync(
        `${getTmuxBin()} display-message -t ${sessionId} -p "#{pane_current_path}"`
      );
      return stdout.trim();
    } catch (error: any) {
      throw new Error(`Failed to get session cwd: ${error.message}`);
    }
  }
}
