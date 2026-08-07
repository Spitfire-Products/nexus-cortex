/**
 * Editor Launcher
 *
 * Launches the user's preferred editor to edit system message files.
 * Detects $EDITOR environment variable or falls back to common editors.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';

/**
 * Editor launch result
 */
export interface EditResult {
  /** Whether the file was modified */
  wasModified: boolean;

  /** Path to the edited file */
  filePath: string;

  /** Editor that was used */
  editor: string;

  /** Exit code from editor */
  exitCode: number;
}

/**
 * Editor Launcher
 *
 * Handles launching external text editors to edit system message files
 */
export class EditorLauncher {
  /**
   * Launch editor to edit a file
   *
   * @param filePath - Absolute path to file to edit
   * @returns Edit result with modification status
   */
  async launchEditor(filePath: string): Promise<EditResult> {
    // Get file hash before editing
    const initialHash = await this.getFileHash(filePath);

    // Detect editor to use
    const editor = this.detectEditor();
    if (!editor) {
      throw new Error(
        'No terminal editor found. Please set $EDITOR environment variable or install nano, vim, or vi.'
      );
    }

    // Spawn editor process
    const exitCode = await this.spawnEditor(editor, filePath);

    // Get file hash after editing
    const finalHash = await this.getFileHash(filePath);

    // Check if file was modified
    const wasModified = initialHash !== finalHash;

    return {
      wasModified,
      filePath,
      editor,
      exitCode,
    };
  }

  /**
   * Detect user's preferred editor
   *
   * Priority:
   * 1. $EDITOR environment variable
   * 2. $VISUAL environment variable
   * 3. Common editors (code, vim, nano, vi)
   *
   * @returns Editor command or null if none found
   */
  private detectEditor(): string | null {
    // Check environment variables
    if (process.env.EDITOR) {
      return process.env.EDITOR;
    }

    if (process.env.VISUAL) {
      return process.env.VISUAL;
    }

    // Try terminal editors only (avoid GUI editors like 'code' that crash in headless environments)
    const terminalEditors = ['nano', 'vim', 'vi'];
    for (const editor of terminalEditors) {
      if (this.isCommandAvailable(editor)) {
        return editor;
      }
    }

    return null;
  }

  /**
   * Check if a command is available in PATH
   */
  private isCommandAvailable(command: string): boolean {
    try {
      // Try 'which' on Unix-like systems
      execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      try {
        // Try 'where' on Windows
        execSync(`where ${command}`, { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Spawn editor process and wait for it to exit
   *
   * @param editor - Editor command
   * @param filePath - File to edit
   * @returns Exit code
   */
  private async spawnEditor(editor: string, filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Parse editor command (may include flags)
      const parts = editor.split(' ');
      const command = parts[0]!;
      const args = [...parts.slice(1), filePath];

      // Spawn editor with inherited stdio (so user can interact)
      const child = spawn(command, args, {
        stdio: 'inherit',
        shell: true,
      });

      child.on('exit', (code) => {
        resolve(code || 0);
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to launch editor: ${error.message}`));
      });
    });
  }

  /**
   * Get file hash (MD5) for modification detection
   */
  private async getFileHash(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return createHash('md5').update(content).digest('hex');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet (new file)
        return '';
      }
      throw error;
    }
  }

  /**
   * Ensure file exists (create if doesn't exist)
   */
  async ensureFileExists(filePath: string, defaultContent: string = ''): Promise<void> {
    if (!existsSync(filePath)) {
      await fs.writeFile(filePath, defaultContent, 'utf-8');
    }
  }
}
