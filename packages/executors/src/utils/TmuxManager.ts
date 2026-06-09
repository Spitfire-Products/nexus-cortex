/**
 * TmuxManager - Singleton for managing tmux sessions
 * Handles persistent terminal session lifecycle and operations
 */
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';

const execAsync = promisify(exec);

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

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): TmuxManager {
    if (!TmuxManager.instance) {
      TmuxManager.instance = new TmuxManager();
    }
    return TmuxManager.instance;
  }

  /**
   * Check if tmux is installed and available
   */
  public async isAvailable(): Promise<boolean> {
    if (this.tmuxAvailable !== null) {
      return this.tmuxAvailable;
    }

    try {
      await execAsync(`${getTmuxBin()} -V`);
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
   * Send keys (command) to a tmux session
   * @param sessionId Session identifier
   * @param command Command to send
   */
  public async sendKeys(sessionId: string, command: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new Error('tmux is not installed');
    }

    try {
      // Send command followed by Enter key
      await execAsync(`${getTmuxBin()} send-keys -t ${sessionId} "${command.replace(/"/g, '\\"')}" Enter`);
    } catch (error: any) {
      throw new Error(`Failed to send keys to session: ${error.message}`);
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
