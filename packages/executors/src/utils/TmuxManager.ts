/**
 * TmuxManager - Singleton for managing tmux sessions
 * Handles persistent terminal session lifecycle and operations
 */
import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as crypto from 'crypto';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * HB-TMUX-PASTE-BUFFER (R140, 2026-09-14): argv exec for the send paths (no host-shell
 * quoting, so `$?` and quotes reach the session verbatim). Injectable for tests.
 */
export interface TmuxExecResult {
  stdout: string;
  stderr: string;
}
export type TmuxExecFn = (bin: string, args: string[]) => Promise<TmuxExecResult>;
export const defaultTmuxExec: TmuxExecFn = async (bin, args) => {
  const { stdout, stderr } = await execFileAsync(bin, args, { maxBuffer: 16 * 1024 * 1024 });
  return { stdout: String(stdout), stderr: String(stderr) };
};

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

    // 5. Fallback to PATH (let shell resolve)
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

  private constructor(private readonly exec: TmuxExecFn = defaultTmuxExec) {}

  /**
   * Get singleton instance
   */
  public static getInstance(): TmuxManager {
    if (!TmuxManager.instance) {
      TmuxManager.instance = new TmuxManager();
    }
    return TmuxManager.instance;
  }

  /** Test hook (R140): a non-singleton instance with an injected exec. */
  public static createWithExec(exec: TmuxExecFn): TmuxManager {
    return new TmuxManager(exec);
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
   * Create a new tmux session
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

    // Build tmux command
    let command = `${getTmuxBin()} new-session -d -s ${sessionId}`;

    // Set working directory if provided
    if (cwd) {
      command += ` -c "${cwd}"`;
    }

    // Set environment variables if provided
    if (env) {
      const envVars = Object.entries(env)
        .map(([key, value]) => `${getTmuxBin()} set-environment -t ${sessionId} ${key} "${value}"`)
        .join(' && ');

      if (envVars) {
        command = `${command} && ${envVars}`;
      }
    }

    try {
      await execAsync(command);
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
